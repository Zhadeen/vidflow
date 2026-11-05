export interface MediaStore {
  put(projectId: string, name: string, data: Blob): Promise<string>; // returns mediaId
  get(mediaId: string): Promise<Blob | undefined>;
  removeProject(projectId: string): Promise<void>;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
}

function mediaId(projectId: string, name: string): string {
  return `${projectId}/${safeName(name)}`;
}

export function memoryMediaStore(): MediaStore {
  const files = new Map<string, Blob>();
  return {
    async put(projectId, name, data) {
      const id = mediaId(projectId, name);
      files.set(id, data);
      return id;
    },
    async get(id) {
      return files.get(id);
    },
    async removeProject(projectId) {
      for (const id of [...files.keys()]) if (id.startsWith(`${projectId}/`)) files.delete(id);
    },
  };
}

// OPFS layout: projects/<projectId>/<name>
export function opfsMediaStore(): MediaStore {
  async function projectsDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('projects', { create: true });
  }
  return {
    async put(projectId, name, data) {
      const dir = await (await projectsDir()).getDirectoryHandle(projectId, { create: true });
      const handle = await dir.getFileHandle(safeName(name), { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return mediaId(projectId, name);
    },
    async get(id) {
      const slash = id.indexOf('/');
      if (slash < 0) return undefined;
      try {
        const dir = await (await projectsDir()).getDirectoryHandle(id.slice(0, slash));
        return await (await dir.getFileHandle(id.slice(slash + 1))).getFile();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return undefined;
        throw e;
      }
    },
    async removeProject(projectId) {
      try {
        await (await projectsDir()).removeEntry(projectId, { recursive: true });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      }
    },
  };
}
