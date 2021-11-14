import child_process from "child_process";
import util from "util";
import os from "os";
import { promises as fs } from "fs";
import path from "path";

export const exec = util.promisify(child_process.exec);

export async function usingTemporaryDirectory<T>(name: string, callback: (path: string) => Promise<T>): Promise<T> {
  const prefix = path.join(os.tmpdir(), name);
  const tmpDirPath = await fs.mkdtemp(prefix);
  try {
    return await callback(tmpDirPath);
  } finally {
    await fs.rm(tmpDirPath, { force: true, recursive: true });
  }
}

export async function checkoutRemoteGitBranch(remote: string, name: string) {
  const { stdout: status } = await exec("git status --porcelain");
  if (status !== "") throw new Error("Must commit or stash changes before proceeding");

  try {
    await exec(`git checkout ${name}`);
  } catch {
    await exec(`git fetch ${remote} ${name}`)
    await exec(`git checkout --track ${remote}/${name}`);
  }

  await exec("git pull");
}

export async function usingRemoteGitBranch<T>(remote: string, name: string, callback: () => Promise<T>): Promise<T> {
  const { stdout: originalBranch } = await exec("git rev-parse --abbrev-ref HEAD");
  await checkoutRemoteGitBranch(remote, name);
  await exec("git pull");
  try {
    return await callback();
  } finally {
    await exec(`git checkout ${originalBranch}`);
  }
}

export function impossible(reason?: string) {
  throw new Error(reason ? `Impossible: ${reason}` : "Impossible");
}

class IsNotDirectoryError extends Error {}

export async function ensureDirectoryExists(path: string){
  try {
    const stats = await fs.stat(path);
    if(!stats.isDirectory()) {
      throw new IsNotDirectoryError(`${path} is not a directory`);
    }
  } catch (e: unknown) {
    if(e instanceof IsNotDirectoryError) {
      throw e;
    } else {
      await fs.mkdir(path);
    }
  }
}