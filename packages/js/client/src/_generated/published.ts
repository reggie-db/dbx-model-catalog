export const PUBLISHED_CATALOG_SCHEMA_VERSION = 15 as const;
export const PUBLISHED_CATALOG_ROOT_URL = "https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web";
export const PUBLISHED_CATALOG_INDEX_URL = `${PUBLISHED_CATALOG_ROOT_URL}/catalog/index.json`;
export const PUBLISHED_CATALOG_SCHEMA_URL = `${PUBLISHED_CATALOG_ROOT_URL}/catalog/v${PUBLISHED_CATALOG_SCHEMA_VERSION}`;
export const PUBLISHED_CATALOG_URL = `${PUBLISHED_CATALOG_SCHEMA_URL}/catalog.json`;
export const PUBLISHED_CATALOG_SEARCH_INDEX_URL = `${PUBLISHED_CATALOG_SCHEMA_URL}/search-index.json`;
export const PUBLISHED_CATALOG_DATABASE_URL = `${PUBLISHED_CATALOG_SCHEMA_URL}/catalog.sqlite`;
