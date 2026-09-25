import type { Database } from "@yeah/db";
import { shellQuote } from "@yeah/shared";

// Dump and restore commands per engine — pure strings, run over SSH by the backup and restore jobs.

/** Names of databases inside one server that a schedule may include (letters, digits, underscore). */
export function isValidIncludedDatabase(name: string): boolean {
  return /^[A-Za-z0-9_]{1,63}$/.test(name);
}

/** Engines whose one instance holds several databases and can therefore dump more than one. */
export function supportsMultiDatabase(engine: Database["engine"]): boolean {
  return engine === "postgresql" || engine === "mysql" || engine === "mariadb" || engine === "mongodb";
}

/** Parses the schedule's comma-separated list; empty means "just the database the resource was created with". */
export function includedDatabases(database: Database, list: string | null | undefined): string[] {
  const names = (list ?? "")
    .split(/[,\s]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  const unique = [...new Set(names)];
  if (unique.length === 0 || !supportsMultiDatabase(database.engine)) return [database.databaseName ?? "app"];
  return unique;
}

/**
 * The compressor: pigz uses every core when the server has it, gzip otherwise. Both read stdin and write
 * stdout, so the rest of a pipeline does not care which one ran.
 */
export const COMPRESSOR_SETUP = 'GZ=$(command -v pigz || command -v gzip); ';

const user = (d: Database, fallback: string) => shellQuote(d.username ?? fallback);

/** Plain (uncompressed) dump of one database to stdout. */
function dumpOne(database: Database, container: string, name: string): string {
  const c = shellQuote(container);
  switch (database.engine) {
    case "postgresql":
      return `docker exec ${c} pg_dump -U ${user(database, "postgres")} ${shellQuote(name)}`;
    case "mysql":
      return `docker exec -e MYSQL_PWD=${shellQuote(database.password)} ${c} mysqldump -u ${user(database, "app")} ${shellQuote(name)}`;
    case "mariadb":
      return `docker exec -e MYSQL_PWD=${shellQuote(database.password)} ${c} mariadb-dump -u ${user(database, "app")} ${shellQuote(name)}`;
    case "mongodb":
      return (
        `docker exec ${c} mongodump --archive ${database.ssl ? "--ssl --sslAllowInvalidCertificates --sslAllowInvalidHostnames " : ""}` +
        `-u ${user(database, "root")} -p ${shellQuote(database.password)} --authenticationDatabase admin --db ${shellQuote(name)}`
      );
    default:
      throw new Error(`dumpOne: ${database.engine} has no per-database dump`);
  }
}

/** Extension of one database's dump inside a multi-database archive. */
function innerExt(engine: Database["engine"]): string {
  return engine === "mongodb" ? "archive" : "sql";
}

/** Whether a backup file is a multi-database archive (a tarball of per-database dumps). */
export function isMultiArchive(filePath: string): boolean {
  return /\.tar\.gz$/.test(filePath);
}

export function dumpFileName(database: Database, names: string[], timestamp = Date.now()): string {
  const label = names.length > 1 ? "multi" : (names[0] ?? database.name);
  if (names.length > 1) return `${database.engine}-dump-${label}-${timestamp}.tar.gz`;
  switch (database.engine) {
    case "postgresql":
      return `pg-dump-${label}-${timestamp}.sql.gz`;
    case "mysql":
      return `mysql-dump-${label}-${timestamp}.sql.gz`;
    case "mariadb":
      return `mariadb-dump-${label}-${timestamp}.sql.gz`;
    case "redis":
      return `redis-dump-${label}-${timestamp}.rdb.gz`;
    case "keydb":
      return `keydb-dump-${label}-${timestamp}.rdb.gz`;
    case "dragonfly":
      return `dragonfly-dump-${label}-${timestamp}.rdb.gz`;
    case "clickhouse":
      return `clickhouse-backup-${label}-${timestamp}.zip`;
    case "mongodb":
      return `mongo-dump-${label}-${timestamp}.archive.gz`;
  }
}

export function buildDumpCommand(database: Database, containerName: string, filePath: string, names: string[]): string {
  const c = shellQuote(containerName);
  const out = shellQuote(filePath);

  if (names.length > 1) {
    const ext = innerExt(database.engine);
    const per = names.map((n) => `${dumpOne(database, containerName, n)} > "$tmp/${n}.${ext}" || exit 1`).join("; ");
    return `${COMPRESSOR_SETUP}tmp=$(mktemp -d) && (${per}) && tar -cf - -C "$tmp" . | $GZ > ${out}; rc=$?; rm -rf "$tmp"; exit $rc`;
  }

  const name = names[0] ?? database.databaseName ?? "app";
  switch (database.engine) {
    case "postgresql":
    case "mysql":
    case "mariadb":
      return `${COMPRESSOR_SETUP}${dumpOne(database, containerName, name)} | $GZ > ${out}`;
    case "mongodb":
      // mongodump's own --gzip keeps the archive self-describing for mongorestore --gzip.
      return `${dumpOne(database, containerName, name).replace("--archive ", "--archive --gzip ")} > ${out}`;
    case "redis":
    case "keydb": {
      const cli = database.engine === "redis" ? "redis-cli" : "keydb-cli";
      return (
        `${COMPRESSOR_SETUP}docker exec ${c} ${cli} ${database.ssl ? "--tls --insecure " : ""}-a ${shellQuote(database.password)} --no-auth-warning --rdb /tmp/dump.rdb >/dev/null && ` +
        `docker exec ${c} cat /tmp/dump.rdb | $GZ > ${out}`
      );
    }
    case "dragonfly":
      throw new Error("o Dragonfly não tem cliente na imagem — backup ainda não é suportado pra esse motor");
    case "clickhouse": {
      const archive = filePath.split("/").pop()!;
      return (
        `docker exec ${c} clickhouse-client -u ${user(database, "app")} --password ${shellQuote(database.password)} ` +
        `-q ${shellQuote(`BACKUP DATABASE \`${name}\` TO File('/backups/${archive}')`)}`
      );
    }
  }
}

// ---------------------------------------------------------------- restore

export interface RestoreStep {
  label: string;
  command: string;
  /** A failure here does not stop the restore (e.g. dropping something that is not there). */
  allowFailure?: boolean;
}

/**
 * Shell that turns `file` into a plain (uncompressed) `out`: gunzip when it starts with the gzip magic
 * bytes, a copy otherwise. Done as its own step writing a file — not `gzip | psql` — because a pipeline
 * reports only its last command, so a corrupt archive would look like a successful, empty restore.
 */
export function plainCopyCommand(file: string, out: string): string {
  const f = shellQuote(file);
  const o = shellQuote(out);
  return `if [ "$(head -c 2 ${f} | od -An -tx1 | tr -d ' \\n')" = 1f8b ]; then gzip -dc ${f} > ${o}; else cp ${f} ${o}; fi`;
}

/** Wipes a database so the dump can be loaded into a clean one. */
function resetDatabase(database: Database, container: string, name: string): RestoreStep[] {
  const c = shellQuote(container);
  const root = `-e MYSQL_PWD=${shellQuote(database.password)}`;
  switch (database.engine) {
    case "postgresql": {
      const reset = { label: `limpando o schema de ${name}`, command: `docker exec ${c} psql -U ${user(database, "postgres")} -d ${shellQuote(name)} -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'` };
      // The default database always exists; any other is created on demand.
      if (name === (database.databaseName ?? "app")) return [reset];
      return [
        {
          label: `criando o banco ${name}`,
          command: `docker exec ${c} psql -U ${user(database, "postgres")} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${name}'" | grep -q 1 || docker exec ${c} psql -U ${user(database, "postgres")} -d postgres -c 'CREATE DATABASE "${name}"'`,
        },
        reset,
      ];
    }
    case "mysql":
    case "mariadb": {
      const client = database.engine === "mysql" ? "mysql" : "mariadb";
      return [{ label: `recriando o banco ${name}`, command: `docker exec ${root} ${c} ${client} -uroot -e 'DROP DATABASE IF EXISTS \`${name}\`; CREATE DATABASE \`${name}\`; GRANT ALL ON \`${name}\`.* TO ${shellQuote(database.username ?? "app")}@"%";'` }];
    }
    default:
      return [];
  }
}

const MONGO_TLS = (d: Database) => (d.ssl ? "--ssl --sslAllowInvalidCertificates --sslAllowInvalidHostnames " : "");

/** Load one plain dump from `plainFile` into `name`. */
function loadOne(database: Database, container: string, name: string, plainFile: string): string {
  const c = shellQuote(container);
  const input = shellQuote(plainFile);
  switch (database.engine) {
    case "postgresql":
      return `docker exec -i ${c} psql -U ${user(database, "postgres")} -d ${shellQuote(name)} -v ON_ERROR_STOP=1 -q < ${input}`;
    case "mysql":
      return `docker exec -i -e MYSQL_PWD=${shellQuote(database.password)} ${c} mysql -uroot ${shellQuote(name)} < ${input}`;
    case "mariadb":
      return `docker exec -i -e MYSQL_PWD=${shellQuote(database.password)} ${c} mariadb -uroot ${shellQuote(name)} < ${input}`;
    case "mongodb":
      return `docker exec -i ${c} mongorestore --archive ${MONGO_TLS(database)}--drop -u ${user(database, "root")} -p ${shellQuote(database.password)} --authenticationDatabase admin --nsInclude ${shellQuote(`${name}.*`)} < ${input}`;
    default:
      throw new Error(`loadOne: ${database.engine}`);
  }
}

/**
 * Steps that put `filePath` (a backup or an uploaded file, on the server) back into the database,
 * replacing what is there.
 */
export function buildRestoreSteps(database: Database, containerName: string, filePath: string, volumeName: string, backupsDir: string): RestoreStep[] {
  const c = shellQuote(containerName);
  const file = shellQuote(filePath);
  const plain = `${filePath}.plain`;
  const cleanup: RestoreStep = { label: "limpando temporários", command: `rm -rf ${shellQuote(plain)} ${shellQuote(filePath + ".d")}`, allowFailure: true };

  switch (database.engine) {
    case "postgresql":
    case "mysql":
    case "mariadb":
    case "mongodb": {
      if (isMultiArchive(filePath)) {
        const ext = innerExt(database.engine);
        // Every file in the archive is one database, named after the file.
        const loop = `for f in ${shellQuote(filePath + ".d")}/*.${ext}; do n=$(basename "$f" .${ext}); ` + restoreLoopBody(database, containerName) + `; done`;
        return [
          { label: "abrindo o arquivo de vários bancos", command: `${plainCopyCommand(filePath, plain)} && rm -rf ${shellQuote(filePath + ".d")} && mkdir -p ${shellQuote(filePath + ".d")} && tar -xf ${shellQuote(plain)} -C ${shellQuote(filePath + ".d")}` },
          { label: "restaurando cada banco", command: loop },
          cleanup,
        ];
      }
      const name = database.databaseName ?? "app";
      if (database.engine === "mongodb") {
        // A single-database dump is mongodump's own (optionally gzip-compressed) archive: mongorestore reads it as is.
        const gz = /\.gz$/.test(filePath) ? "--gzip " : "";
        return [
          {
            label: `restaurando ${name}`,
            command: `docker exec -i ${c} mongorestore --archive ${gz}${MONGO_TLS(database)}--drop -u ${user(database, "root")} -p ${shellQuote(database.password)} --authenticationDatabase admin --nsInclude ${shellQuote(`${name}.*`)} < ${file}`,
          },
        ];
      }
      return [
        { label: "preparando o dump", command: plainCopyCommand(filePath, plain) },
        ...resetDatabase(database, containerName, name),
        { label: `carregando o dump em ${name}`, command: loadOne(database, containerName, name, plain) },
        cleanup,
      ];
    }
    case "redis":
    case "keydb":
    case "dragonfly": {
      // These servers run with appendonly on, and then IGNORE dump.rdb at start-up (they build a fresh AOF
      // instead). An AOF may begin with an RDB payload, so the dump is placed as the legacy single-file
      // appendonly.aof: both Redis and KeyDB load it and convert it to their own AOF layout. The container is
      // stopped first (it would otherwise rewrite the files on the way out) and started again after.
      const image = shellQuote(database.image);
      const inner = `rm -rf /data/appendonlydir /data/appendonly.aof && if [ "$(head -c 2 /restore.rdb | od -An -tx1 | tr -d ' \n')" = 1f8b ]; then gzip -dc /restore.rdb > /data/dump.rdb; else cp /restore.rdb /data/dump.rdb; fi && cp /data/dump.rdb /data/appendonly.aof && chown --reference=/data /data/dump.rdb /data/appendonly.aof 2>/dev/null; true`;
      return [
        { label: "parando o banco", command: `docker stop ${c}` },
        {
          label: "colocando o dump no volume de dados",
          command: `docker run --rm --entrypoint sh -v ${shellQuote(volumeName)}:/data -v ${file}:/restore.rdb:ro ${image} -c ${shellQuote(inner)}`,
        },
        { label: "iniciando o banco", command: `docker start ${c}` },
      ];
    }
    case "clickhouse": {
      const name = database.databaseName ?? "app";
      const inBackups = filePath.startsWith(backupsDir + "/") ? filePath.slice(backupsDir.length + 1) : null;
      const steps: RestoreStep[] = [];
      let archive = inBackups;
      if (!archive) {
        archive = `restore-${Date.now()}.zip`;
        steps.push({ label: "copiando o arquivo pra pasta de backups", command: `cp ${file} ${shellQuote(`${backupsDir}/${archive}`)} && chmod 644 ${shellQuote(`${backupsDir}/${archive}`)}` });
      }
      const q = (sql: string) => `docker exec ${c} clickhouse-client -u ${user(database, "app")} --password ${shellQuote(database.password)} -q ${shellQuote(sql)}`;
      steps.push({ label: `removendo o banco ${name} atual`, command: q(`DROP DATABASE IF EXISTS \`${name}\` SYNC`) });
      steps.push({ label: `restaurando ${name}`, command: q(`RESTORE DATABASE \`${name}\` FROM File('/backups/${archive}')`) });
      return steps;
    }
  }
}

/** Body of the per-database loop over an unpacked multi-database archive ($f = the dump, $n = its name). */
function restoreLoopBody(database: Database, container: string): string {
  const c = shellQuote(container);
  const root = `MYSQL_PWD=${shellQuote(database.password)}`;
  switch (database.engine) {
    case "postgresql":
      return (
        `docker exec ${c} psql -U ${user(database, "postgres")} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$n'" | grep -q 1 || docker exec ${c} psql -U ${user(database, "postgres")} -d postgres -c "CREATE DATABASE \\"$n\\"" || exit 1; ` +
        `docker exec ${c} psql -U ${user(database, "postgres")} -d "$n" -q -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && ` +
        `docker exec -i ${c} psql -U ${user(database, "postgres")} -d "$n" -v ON_ERROR_STOP=1 -q < "$f" || exit 1`
      );
    case "mysql":
    case "mariadb": {
      const client = database.engine === "mysql" ? "mysql" : "mariadb";
      return (
        `docker exec -e ${root} ${c} ${client} -uroot -e "DROP DATABASE IF EXISTS \\\`$n\\\`; CREATE DATABASE \\\`$n\\\`; GRANT ALL ON \\\`$n\\\`.* TO ${shellQuote(database.username ?? "app")}@'%';" && ` +
        `docker exec -i -e ${root} ${c} ${client} -uroot "$n" < "$f" || exit 1`
      );
    }
    case "mongodb":
      return `docker exec -i ${c} mongorestore --archive ${MONGO_TLS(database)}--drop -u ${user(database, "root")} -p ${shellQuote(database.password)} --authenticationDatabase admin --nsInclude "$n.*" < "$f" || exit 1`;
    default:
      return "true";
  }
}
