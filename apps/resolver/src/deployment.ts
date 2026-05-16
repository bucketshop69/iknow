import { localDeploymentSchema, type LocalDeployment } from "@iknow/shared";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultDeploymentPath = "contracts/deployments/local-anvil.json";

export async function readDeployment(path = defaultDeploymentPath): Promise<LocalDeployment> {
  const raw = await readFile(await resolveDeploymentPath(path), "utf8");
  return localDeploymentSchema.parse(JSON.parse(raw));
}

async function resolveDeploymentPath(path: string): Promise<string> {
  const cwdPath = resolve(process.cwd(), path);
  try {
    await readFile(cwdPath, "utf8");
    return cwdPath;
  } catch {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    return resolve(packageRoot, "../..", path);
  }
}
