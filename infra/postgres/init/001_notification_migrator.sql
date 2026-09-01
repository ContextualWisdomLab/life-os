DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'lifeos_migrator'
  ) THEN
    CREATE ROLE lifeos_migrator
      WITH LOGIN PASSWORD 'lifeos'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT, CREATE ON DATABASE lifeos TO lifeos_migrator;

COMMENT ON ROLE lifeos_migrator IS
  'Local Compose migration identity. It owns forward-only migration objects while the lifeos runtime role receives only explicitly granted runtime privileges.';
