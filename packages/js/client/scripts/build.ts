import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dir, '..');
const workspaceRoot = resolve(root, '../../..');
const dist = resolve(root, 'dist');
await rm(dist, { force: true, recursive: true });

const nodeResult = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts'), resolve(root, 'src/cli.ts')],
  external: ['fs-ext'],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'node',
});

if (!nodeResult.success) {
  for (const log of nodeResult.logs) console.error(log);
  process.exit(1);
}
const browserResult = await Bun.build({
  entrypoints: [resolve(root, 'src/browser.ts')],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'browser',
});
if (!browserResult.success) {
  for (const log of browserResult.logs) console.error(log);
  process.exit(1);
}
await emitDeclarations();
await stagePythonRuntime();
await chmod(resolve(dist, 'cli.js'), 0o755);

async function emitDeclarations(): Promise<void> {
  const child = Bun.spawn(
    [process.execPath, 'run', 'tsc', '--project', resolve(root, 'tsconfig.build.json')],
    {
      cwd: workspaceRoot,
      stderr: 'inherit',
      stdout: 'inherit',
    },
  );
  if (await child.exited !== 0) {
    throw new Error('TypeScript declaration generation failed');
  }
}

async function stagePythonRuntime(): Promise<void> {
  const pythonRoot = resolve(dist, 'python');
  const pythonSource = resolve(pythonRoot, 'src');
  const coreRoot = resolve(workspaceRoot, 'packages/py/core');
  const serverRoot = resolve(workspaceRoot, 'packages/py/server');
  await mkdir(pythonSource, { recursive: true });
  await Promise.all([
    copyPythonPackage(coreRoot, pythonSource, 'dbx_model_catalog'),
    copyPythonPackage(serverRoot, pythonSource, 'dbx_model_catalog_server'),
  ]);

  const [coreProject, serverProject, packageManifest] = await Promise.all([
    readPythonProject(coreRoot),
    readPythonProject(serverRoot),
    Bun.file(resolve(root, 'package.json')).json() as Promise<{ version: string }>,
  ]);
  const dependencies = [
    ...coreProject.dependencies,
    ...serverProject.dependencies.filter(
      dependency => dependency !== 'dbx-model-catalog',
    ),
  ];
  if (serverProject.pynectApp === undefined) {
    throw new Error(`Missing Pynect app metadata: ${serverRoot}`);
  }
  const pyproject = Bun.TOML.stringify({
    'build-system': {
      requires: ['hatchling>=1.28,<2'],
      'build-backend': 'hatchling.build',
    },
    project: {
      name: 'dbx-model-catalog-runtime',
      version: packageManifest.version,
      'requires-python': coreProject.requiresPython,
      dependencies: [...new Set(dependencies)],
    },
    tool: {
      pynect: {
        app: serverProject.pynectApp,
      },
      hatch: {
        build: {
          targets: {
            wheel: {
              packages: [
                'src/dbx_model_catalog',
                'src/dbx_model_catalog_server',
              ],
            },
          },
        },
      },
    },
  });
  await writeFile(resolve(pythonRoot, 'pyproject.toml'), `${pyproject}\n`);
}

async function copyPythonPackage(
  projectRoot: string,
  destinationRoot: string,
  packageName: string,
): Promise<void> {
  await cp(
    resolve(projectRoot, 'src', packageName),
    resolve(destinationRoot, packageName),
    {
      recursive: true,
      filter: source =>
        !source.split(sep).includes('__pycache__') && !source.endsWith('.pyc'),
    },
  );
}

async function readPythonProject(projectRoot: string): Promise<{
  dependencies: string[];
  pynectApp?: string;
  requiresPython: string;
}> {
  const parsed = Bun.TOML.parse(
    await readFile(resolve(projectRoot, 'pyproject.toml'), 'utf8'),
  ) as {
    project?: {
      dependencies?: unknown;
      'requires-python'?: unknown;
    };
    tool?: {
      pynect?: {
        app?: unknown;
      };
    };
  };
  const dependencies = parsed.project?.dependencies;
  const requiresPython = parsed.project?.['requires-python'];
  if (
    !Array.isArray(dependencies) ||
    !dependencies.every(dependency => typeof dependency === 'string') ||
    typeof requiresPython !== 'string'
  ) {
    throw new Error(`Invalid Python project metadata: ${projectRoot}`);
  }
  const pynectApp = parsed.tool?.pynect?.app;
  if (pynectApp !== undefined && typeof pynectApp !== 'string') {
    throw new Error(`Invalid Pynect app metadata: ${projectRoot}`);
  }
  return { dependencies, pynectApp, requiresPython };
}
