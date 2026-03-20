// This file runs before any test module is imported.
// Set the test DB path before config.ts is evaluated so tests
// never touch the production ./data/valor.db file.
process.env.VALOR_DB_PATH = "./data/valor-test.db";
