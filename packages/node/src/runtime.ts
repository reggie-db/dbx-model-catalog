import { pyfigOptionsSchema, type PyfigOptions } from "pyfig";

export const PYTHON_RUNTIME_ENVIRONMENT = {
  UV_ASTRAL_MIRROR_URL: "https://releases.astral.sh",
  UV_PYTHON_INSTALL_MIRROR:
    "https://releases.astral.sh/github/python-build-standalone/releases/download",
} as const;

export function pythonRuntimeEnvironment(
  env?: PyfigOptions["env"],
): Record<string, string | undefined> {
  const parsed = pyfigOptionsSchema.parse({ env });
  return { ...PYTHON_RUNTIME_ENVIRONMENT, ...parsed.env };
}
