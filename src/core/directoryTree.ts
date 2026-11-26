import type { DirectoryEntry, DirectoryListing, DirectoryPort } from "./types";

export interface DirectoryNode extends DirectoryEntry {
  expanded?: boolean;
  loading?: boolean;
  children?: DirectoryNode[];
}

function nodes(listing: DirectoryListing): DirectoryNode[] {
  return listing.entries.map((entry) => ({ ...entry }));
}

export class DirectoryTree {
  root?: DirectoryNode;
  opening = false;
  private generation = 0;

  constructor(readonly directories: DirectoryPort) {}

  async open(path: string): Promise<void> {
    const generation = ++this.generation;
    this.opening = true;
    try {
      const listing = await this.directories.list(path);
      if (generation !== this.generation) return;
      this.root = { path: listing.root, name: listing.name, kind: "directory", expanded: true, children: nodes(listing) };
    } finally {
      if (generation === this.generation) this.opening = false;
    }
  }

  close(): void {
    this.generation += 1;
    this.root = undefined;
    this.opening = false;
  }

  async toggle(node: DirectoryNode): Promise<boolean> {
    if (node.kind !== "directory") return false;
    if (node.expanded) {
      node.expanded = false;
      return true;
    }
    if (node.children) {
      node.expanded = true;
      return true;
    }
    if (node.loading) return false;
    const generation = this.generation;
    node.loading = true;
    try {
      const listing = await this.directories.list(node.path);
      if (generation !== this.generation || !this.root) return false;
      node.children = nodes(listing);
      node.expanded = true;
      return true;
    } finally {
      node.loading = false;
    }
  }
}
