export interface DirectoryMember {
  externalId: string;
  login: string;
  displayName: string;
  isActive: boolean;
}

/** Map a GitHub org-members API entry to our internal directory shape. */
export function toDirectoryMember(entry: {
  id: number;
  login: string;
  name: string | null;
  suspended_at: string | null;
}): DirectoryMember {
  return {
    externalId: String(entry.id),
    login: entry.login,
    displayName: entry.name ?? entry.login,
    isActive: entry.suspended_at === null,
  };
}
