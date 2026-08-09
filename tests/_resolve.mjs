// Lets Node resolve the project's extensionless relative TypeScript imports, so
// the pure modules can be tested with the runtime's own type stripping and no
// build step or test framework in between.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) {
        return { url: url.href, shortCircuit: true, format: 'module-typescript' };
      }
    }
  }
  return nextResolve(specifier, context);
}
