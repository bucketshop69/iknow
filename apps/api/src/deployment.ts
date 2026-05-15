import { readFile } from "node:fs/promises";
import path from "node:path";
import { localDeploymentSchema, type LocalDeployment } from "@iknow/shared";

export const DEFAULT_DEPLOYMENT_PATH = "contracts/deployments/local-anvil.json";

export async function readLocalDeployment(
  deploymentPath = process.env.IKNOW_DEPLOYMENT_PATH ?? DEFAULT_DEPLOYMENT_PATH,
): Promise<LocalDeployment> {
  const candidates = path.isAbsolute(deploymentPath)
    ? [deploymentPath]
    : [path.resolve(process.cwd(), deploymentPath), path.resolve(process.cwd(), "../..", deploymentPath)];
  let file: string | undefined;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      file = await readFile(candidate, "utf8");
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!file) {
    throw lastError instanceof Error ? lastError : new Error(`Unable to read ${deploymentPath}`);
  }

  return localDeploymentSchema.parse(JSON.parse(file));
}
