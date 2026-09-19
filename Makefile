setup:
	corepack enable
	corepack prepare pnpm@9.15.9 --activate
	pnpm install

test:
	pnpm test

typecheck:
	pnpm typecheck

matrix:
	pnpm isotope matrix --group detection

acceptance:
	pnpm isotope matrix --group acceptance

accuracy:
	pnpm isotope accuracy

fleet:
	pnpm isotope fleet --repos corpus/repos.json --out dist/dashboard.html
