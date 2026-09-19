import type { Database } from "@yeah/db";
import { resourceLimitFlags, shellQuote } from "@yeah/shared";

// Pure command-building logic, kept separate from provisionDatabase.ts's SSH execution for the
// same reason as deployApplication.commands.ts — see that file's comment.

export function containerNameForDatabase(databaseId: string): string {
  return `yeah-db-${databaseId}`;
}

export function buildRunCommand(database: Database, containerName: string, volumeName: string): string {
  const base = `docker run -d --name ${shellQuote(containerName)} ` + resourceLimitFlags(database);
  const restart = `--restart unless-stopped ${shellQuote(database.image)}`;

  switch (database.engine) {
    case "postgresql":
      return (
        base +
        `-e POSTGRES_USER=${shellQuote(database.username ?? "postgres")} ` +
        `-e POSTGRES_PASSWORD=${shellQuote(database.password)} ` +
        `-e POSTGRES_DB=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:5432 ` +
        `-v ${shellQuote(volumeName)}:/var/lib/postgresql/data ` +
        restart
      );
    case "mysql":
      return (
        base +
        `-e MYSQL_ROOT_PASSWORD=${shellQuote(database.password)} ` +
        `-e MYSQL_USER=${shellQuote(database.username ?? "app")} ` +
        `-e MYSQL_PASSWORD=${shellQuote(database.password)} ` +
        `-e MYSQL_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:3306 ` +
        `-v ${shellQuote(volumeName)}:/var/lib/mysql ` +
        restart
      );
    case "mariadb":
      return (
        base +
        `-e MARIADB_ROOT_PASSWORD=${shellQuote(database.password)} ` +
        `-e MARIADB_USER=${shellQuote(database.username ?? "app")} ` +
        `-e MARIADB_PASSWORD=${shellQuote(database.password)} ` +
        `-e MARIADB_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:3306 ` +
        `-v ${shellQuote(volumeName)}:/var/lib/mysql ` +
        restart
      );
    case "redis":
      return (
        base +
        `-p ${database.port}:6379 ` +
        `-v ${shellQuote(volumeName)}:/data ` +
        restart +
        ` redis-server --requirepass ${shellQuote(database.password)} --appendonly yes`
      );
    case "mongodb":
      return (
        base +
        `-e MONGO_INITDB_ROOT_USERNAME=${shellQuote(database.username ?? "root")} ` +
        `-e MONGO_INITDB_ROOT_PASSWORD=${shellQuote(database.password)} ` +
        `-e MONGO_INITDB_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:27017 ` +
        `-v ${shellQuote(volumeName)}:/data/db ` +
        restart
      );
  }
}
