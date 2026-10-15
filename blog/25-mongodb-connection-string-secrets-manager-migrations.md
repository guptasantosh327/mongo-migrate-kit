<!--
SEO target keyword: "mongodb connection string secrets manager"
Meta description: Keep the MongoDB connection string for your migrations in AWS Secrets Manager, GCP
Secret Manager, Vault or Azure Key Vault, fetched at runtime by the config file and never written to
disk or CI variables.
Works with mongo-migrate-kit 1.4 and newer. Can be published any time.
-->

# Loading your migration connection string from a secret manager

The easy way to give a migration tool its connection string is an environment variable:
`MMK_URI=mongodb+srv://deploy:…@cluster/`. It works, and for many teams it's fine.

But in plenty of companies, the database password isn't *supposed* to live in CI variables or a
Kubernetes secret at all. It lives in AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault or
Azure Key Vault, rotated automatically and readable only by roles that need it. Your migrations
should fetch it from there at runtime, like your app does.

mongo-migrate-kit ships no cloud SDKs. Instead, its config file can be an **async function**, and
you fetch the secret inside it.

## Generate the config

```bash
npx mmk init --secret-provider          # or add --ts for TypeScript
```

You get a config that exports a function instead of an object (trimmed):

```js
// mmk.config.js
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

async function loadMongoSecret() {
  // Secret name/ARN. Read from an env var so it can differ per environment.
  const secretId = process.env.MONGO_SECRET_ID ?? 'prod/myapp/mongo';

  // Region & credentials come from the environment (AWS_REGION,
  // AWS_ACCESS_KEY_ID/SECRET, or an attached IAM role).
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (!res.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString`);
  }
  // Stored value is JSON, e.g. { "uri": "mongodb+srv://...", "dbName": "myapp" }
  return JSON.parse(res.SecretString);
}

export default async () => {
  const secret = await loadMongoSecret();
  return {
    uri: secret.uri,
    dbName: secret.dbName,
    migrationsDir: './migrations',
  };
};
```

Every `mmk` command calls this function first. The connection string stays in memory. It's never in
a file, and never in the CI log. If the secret can't be read, the command fails with your provider's own
error message, so "access denied" looks like "access denied".

Install the SDK as a **dependency** (`npm install @aws-sdk/client-secrets-manager`), so it's in the
production image too. The deploy role needs `secretsmanager:GetSecretValue` on that one secret.

## Other providers: swap the function body

`loadMongoSecret()` just has to return `{ uri, dbName }`. The rest of the file stays the same.

**Google Secret Manager:**

```js
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

async function loadMongoSecret() {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: 'projects/my-project/secrets/mongo/versions/latest',
  });
  return JSON.parse(version.payload.data.toString());
}
```

**HashiCorp Vault** (KV v2, over plain HTTP, no SDK needed):

```js
async function loadMongoSecret() {
  const res = await fetch(`${process.env.VAULT_ADDR}/v1/secret/data/myapp/mongo`, {
    headers: { 'X-Vault-Token': process.env.VAULT_TOKEN },
  });
  if (!res.ok) throw new Error(`Vault returned ${res.status}`);
  const body = await res.json();
  return body.data.data; // { uri, dbName }
}
```

**Azure Key Vault:**

```js
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

async function loadMongoSecret() {
  const client = new SecretClient(process.env.KEY_VAULT_URL, new DefaultAzureCredential());
  const secret = await client.getSecret('mongo');
  return JSON.parse(secret.value);
}
```

## Local development without cloud credentials

Environment variables still win over the config file, so a developer can point mmk at a local
database with `MMK_URI` and `MMK_DB`. But the function still runs, and on a laptop without cloud
credentials, the secret fetch fails first.

Skip the fetch when the connection is already provided:

```js
export default async () => {
  // Local: MMK_URI/MMK_DB are set, so don't call the secret manager
  if (process.env.MMK_URI) {
    return { migrationsDir: './migrations' };
  }
  const secret = await loadMongoSecret();
  return { uri: secret.uri, dbName: secret.dbName, migrationsDir: './migrations' };
};
```

## Passwords never leak through errors

One more thing you get for free: when a connection fails, mongo-migrate-kit removes the
`user:password@` part of the URI before it appears in an error message, a log line or `--json`
output. A typo in the host doesn't put your password in a CI log.

## In short

Make the config a function, fetch `{ uri, dbName }` from your secrets manager inside it, install the
SDK as a real dependency, and give the deploy role read access to one secret. Nothing sensitive is
ever written down.

## Try it

```bash
npm install mongo-migrate-kit mongodb @aws-sdk/client-secrets-manager
npx mmk init --secret-provider
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/configuration#loading-the-connection-string-from-a-secret-manager**
· npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [MongoDB migrations in GitHub Actions](./08-mongodb-migrations-ci-cd-github-actions.md):
  where this config gets used.
- [MongoDB migrations on Kubernetes](./22-mongodb-migrations-kubernetes-job-helm.md): running it in
  a cluster, with the role attached to the Job.
