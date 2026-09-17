export interface ServiceCatalogEntry {
  key: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  port: number;
  /** Container path that should get a persistent named volume — null if the service is stateless. */
  volumePath: string | null;
  /** Pre-filled ".env" content the user sees (and can edit) before deploying — generated
   * passwords/keys are placeholders like "changeme", not actually random per instance. */
  envTemplate: string;
  /** Extra context shown in the UI — e.g. "precisa de um MySQL, crie um banco antes". */
  notes?: string;
}

export const SERVICE_CATALOG: ServiceCatalogEntry[] = [
  {
    key: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Monitoramento de uptime self-hosted, com alertas — tipo um Pingdom seu.",
    icon: "monitor_heart",
    image: "louislam/uptime-kuma:1",
    port: 3001,
    volumePath: "/app/data",
    envTemplate: "",
  },
  {
    key: "n8n",
    name: "n8n",
    description: "Automação de workflows low-code (tipo Zapier/Make, self-hosted).",
    icon: "hub",
    image: "n8nio/n8n:latest",
    port: 5678,
    volumePath: "/home/node/.n8n",
    envTemplate: "N8N_HOST=localhost\nN8N_PROTOCOL=http\nGENERIC_TIMEZONE=America/Sao_Paulo\n",
  },
  {
    key: "minio",
    name: "MinIO",
    description: "Armazenamento de objetos S3-compatível — use como destino de backup do próprio yeah.",
    icon: "cloud",
    image: "quay.io/minio/minio:latest",
    port: 9000,
    volumePath: "/data",
    envTemplate: "MINIO_ROOT_USER=admin\nMINIO_ROOT_PASSWORD=changeme123\n",
    notes: "Comando do container roda 'server /data --console-address :9001' — o console fica na porta 9001, não exposta pelo domínio principal.",
  },
  {
    key: "rabbitmq",
    name: "RabbitMQ",
    description: "Fila de mensagens com plugin de management incluso.",
    icon: "sync_alt",
    image: "rabbitmq:3-management-alpine",
    port: 5672,
    volumePath: "/var/lib/rabbitmq",
    envTemplate: "RABBITMQ_DEFAULT_USER=admin\nRABBITMQ_DEFAULT_PASS=changeme123\n",
    notes: "Painel de management fica na porta 15672, não exposta pelo domínio principal.",
  },
  {
    key: "meilisearch",
    name: "Meilisearch",
    description: "Motor de busca full-text rápido, API REST simples.",
    icon: "search",
    image: "getmeili/meilisearch:latest",
    port: 7700,
    volumePath: "/meili_data",
    envTemplate: "MEILI_MASTER_KEY=changeme123\n",
  },
  {
    key: "ghost",
    name: "Ghost",
    description: "Plataforma de blog/newsletter — roda com SQLite embutido, sem precisar de banco externo.",
    icon: "article",
    image: "ghost:5-alpine",
    port: 2368,
    volumePath: "/var/lib/ghost/content",
    envTemplate: "NODE_ENV=production\n",
  },
  {
    key: "metabase",
    name: "Metabase",
    description: "BI/dashboards conectando em qualquer banco de dados.",
    icon: "bar_chart",
    image: "metabase/metabase:latest",
    port: 3000,
    volumePath: "/metabase-data",
    envTemplate: "MB_DB_FILE=/metabase-data/metabase.db\n",
  },
  {
    key: "portainer",
    name: "Portainer",
    description: "GUI de administração Docker — mostra containers/imagens/volumes do servidor.",
    icon: "dns",
    image: "portainer/portainer-ce:latest",
    port: 9000,
    volumePath: "/data",
    envTemplate: "",
    notes: "Precisa de acesso ao docker.sock do servidor — só use em servidor de confiança.",
  },
  {
    key: "adminer",
    name: "Adminer",
    description: "Cliente web leve pra Postgres/MySQL/SQLite — cole host/usuário/senha de qualquer banco criado no yeah.",
    icon: "table_view",
    image: "adminer:latest",
    port: 8080,
    volumePath: null,
    envTemplate: "",
  },
  {
    key: "redis-commander",
    name: "Redis Commander",
    description: "GUI web pra inspecionar um Redis já existente.",
    icon: "table_rows",
    image: "rediscommander/redis-commander:latest",
    port: 8081,
    volumePath: null,
    envTemplate: "REDIS_HOSTS=local:host.docker.internal:6379\n",
    notes: "Edite REDIS_HOSTS pra apontar pro Redis que você quer inspecionar (host:porta do banco criado no yeah).",
  },
];

export function findServiceCatalogEntry(key: string): ServiceCatalogEntry | undefined {
  return SERVICE_CATALOG.find((entry) => entry.key === key);
}
