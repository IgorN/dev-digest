import { buildBlastRadiusStub, type BlastRadiusStub } from '../domain/shape.js';

export interface GetBlastRadiusInput {
  repo: string;
  pr_number: number;
}

/**
 * Application ring — but note there is no `DevDigestApi` dependency here at
 * all. Real blast-radius analysis does not exist anywhere in the DevDigest
 * codebase yet (confirmed: no table, module, or route — only mentions in
 * `.claude/` planning docs), so this use-case does zero I/O and can never
 * fabricate data; it only forwards to the pure domain stub builder.
 */
export function makeGetBlastRadiusUseCase() {
  return function getBlastRadius(input: GetBlastRadiusInput): BlastRadiusStub {
    return buildBlastRadiusStub(input.repo, input.pr_number);
  };
}
