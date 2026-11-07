interface RegistryReference {
  readonly registry: string;
  readonly repository: string;
  readonly reference: string;
}

interface ManifestDescriptor {
  readonly digest: string;
  readonly platform?: {
    readonly architecture?: string;
    readonly os?: string;
  };
}

interface ImageManifest {
  readonly config?: { readonly digest?: string };
  readonly manifests?: readonly ManifestDescriptor[];
}

function parseReference(value: string): RegistryReference {
  const slash = value.indexOf('/');
  if (slash < 1) throw new Error(`Container reference must include a registry: ${value}`);
  const registry = value.slice(0, slash);
  const remainder = value.slice(slash + 1);
  const digestIndex = remainder.lastIndexOf('@');
  if (digestIndex >= 0) {
    return {
      registry,
      repository: remainder.slice(0, digestIndex),
      reference: remainder.slice(digestIndex + 1),
    };
  }
  const colon = remainder.lastIndexOf(':');
  return {
    registry,
    repository: colon >= 0 ? remainder.slice(0, colon) : remainder,
    reference: colon >= 0 ? remainder.slice(colon + 1) : 'latest',
  };
}

function challengeValue(challenge: string, name: string): string {
  const value = challenge.match(new RegExp(`${name}="([^"]+)"`))?.[1];
  if (value === undefined) throw new Error(`Registry challenge is missing ${name}`);
  return value;
}

async function registryToken(reference: RegistryReference): Promise<string> {
  const base = `https://${reference.registry}/v2/${reference.repository}`;
  const response = await fetch(`${base}/manifests/${reference.reference}`);
  const challenge = response.headers.get('www-authenticate');
  if (challenge === null) throw new Error(`Registry did not return an authentication challenge (${response.status})`);
  const tokenUrl = new URL(challengeValue(challenge, 'realm'));
  tokenUrl.searchParams.set('service', challengeValue(challenge, 'service'));
  tokenUrl.searchParams.set('scope', challengeValue(challenge, 'scope'));
  const tokenResponse = await fetch(tokenUrl);
  if (!tokenResponse.ok) throw new Error(`Anonymous token request failed: ${tokenResponse.status}`);
  const payload = await tokenResponse.json() as { access_token?: string; token?: string };
  const token = payload.token ?? payload.access_token;
  if (token === undefined) throw new Error('Anonymous registry token is missing');
  return token;
}

async function main(): Promise<void> {
  const image = process.argv[2] ?? process.env.CONTAINER_IMAGE ?? 'ghcr.io/reggie-db/dbx-model-catalog:latest';
  const reference = parseReference(image);
  const token = await registryToken(reference);
  const base = `https://${reference.registry}/v2/${reference.repository}`;
  const headers = {
    Accept: [
      'application/vnd.oci.image.index.v1+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.v2+json',
    ].join(', '),
    Authorization: `Bearer ${token}`,
  };
  const manifestResponse = await fetch(`${base}/manifests/${reference.reference}`, { headers });
  if (!manifestResponse.ok) throw new Error(`Anonymous manifest request failed: ${manifestResponse.status}`);
  const digest = manifestResponse.headers.get('docker-content-digest');
  const manifest = await manifestResponse.json() as ImageManifest;
  const amd64 = manifest.manifests?.find(
    entry => entry.platform?.os === 'linux' && entry.platform.architecture === 'amd64',
  );
  const platformReference = amd64?.digest ?? reference.reference;
  const platformResponse = await fetch(`${base}/manifests/${platformReference}`, { headers });
  if (!platformResponse.ok) throw new Error(`Platform manifest request failed: ${platformResponse.status}`);
  const platformManifest = await platformResponse.json() as ImageManifest;
  const configDigest = platformManifest.config?.digest;
  if (configDigest === undefined) throw new Error('Image config digest is missing');
  const configResponse = await fetch(`${base}/blobs/${configDigest}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!configResponse.ok) throw new Error(`Image config request failed: ${configResponse.status}`);
  const config = await configResponse.json() as {
    readonly config?: {
      readonly Cmd?: readonly string[];
      readonly ExposedPorts?: Readonly<Record<string, object>>;
      readonly Healthcheck?: { readonly Test?: readonly string[] };
      readonly Labels?: Readonly<Record<string, string>>;
      readonly User?: string;
    };
  };
  const expectedRevision = process.env.CONTAINER_EXPECTED_REVISION;
  const actualRevision = config.config?.Labels?.['org.opencontainers.image.revision'];
  if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
    throw new Error(`Image revision mismatch: expected ${expectedRevision}, received ${actualRevision ?? 'none'}`);
  }
  if (config.config?.User !== 'bun') throw new Error(`Image user is not bun: ${config.config?.User ?? 'none'}`);
  if (config.config?.ExposedPorts?.['8080/tcp'] === undefined) throw new Error('Image does not expose port 8080');
  if (config.config?.Cmd?.join(' ') !== 'bun packages/js/static-server/src/server.ts') {
    throw new Error(`Unexpected image command: ${config.config?.Cmd?.join(' ') ?? 'none'}`);
  }
  if (!config.config?.Healthcheck?.Test?.join(' ').includes('/healthz')) {
    throw new Error('Image health check does not use /healthz');
  }

  console.log(JSON.stringify({
    digest,
    image,
    platform: 'linux/amd64',
    revision: actualRevision,
    verified: true,
  }, null, 2));
}

await main();
