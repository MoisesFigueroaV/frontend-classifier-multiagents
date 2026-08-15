export type RepositoryFile = {
  path: string;
  content: string;
};

export type RepositorySnapshot = {
  projectName: string;
  files: RepositoryFile[];
};
