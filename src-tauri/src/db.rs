use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::fmt;
use std::path::Path;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub enum DbError {
    Sql(rusqlite::Error),
    InvalidSnapshot(String),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(f, "sqlite error: {error}"),
            Self::InvalidSnapshot(error) => write!(f, "invalid snapshot: {error}"),
        }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

pub struct SnapshotDb {
    connection: Connection,
}

impl SnapshotDb {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let connection = Connection::open(path)?;
        let mut database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, DbError> {
        let connection = Connection::open_in_memory()?;
        let mut database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn migrate(&mut self) -> Result<(), DbError> {
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_snapshot (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               schema_version INTEGER NOT NULL,
               payload TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );",
        )?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn load_snapshot(&self) -> Result<Option<Value>, DbError> {
        let raw: Option<String> = self
            .connection
            .query_row("SELECT payload FROM app_snapshot WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let value: Value = serde_json::from_str(&raw)
            .map_err(|error| DbError::InvalidSnapshot(error.to_string()))?;
        validate_snapshot(&value)?;
        Ok(Some(value))
    }

    pub fn save_snapshot(&mut self, snapshot: &Value) -> Result<(), DbError> {
        validate_snapshot(snapshot)?;
        let payload = serde_json::to_string(snapshot)
            .map_err(|error| DbError::InvalidSnapshot(error.to_string()))?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO app_snapshot(id, schema_version, payload, updated_at)
             VALUES(1, ?1, ?2, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               schema_version = excluded.schema_version,
               payload = excluded.payload,
               updated_at = excluded.updated_at",
            params![SCHEMA_VERSION, payload],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

fn validate_snapshot(snapshot: &Value) -> Result<(), DbError> {
    let object = snapshot
        .as_object()
        .ok_or_else(|| DbError::InvalidSnapshot("root must be an object".into()))?;
    for field in ["memos", "reminders", "blackboardItems"] {
        if !object.get(field).is_some_and(Value::is_array) {
            return Err(DbError::InvalidSnapshot(format!("missing array: {field}")));
        }
    }
    for (field, records) in object {
        if matches!(
            field.as_str(),
            "memos"
                | "reminders"
                | "blackboardItems"
                | "courseSchedules"
                | "countdowns"
                | "syncRuns"
                | "externalMappings"
        ) && !records.is_array()
        {
            return Err(DbError::InvalidSnapshot(format!(
                "{field} must be an array"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> Value {
        serde_json::json!({
            "memos": [], "reminders": [], "blackboardItems": [],
            "syncRuns": [], "externalMappings": []
        })
    }

    #[test]
    fn saves_and_loads_a_snapshot_transactionally() {
        let mut db = SnapshotDb::open_in_memory().unwrap();
        let expected = snapshot();
        db.save_snapshot(&expected).unwrap();
        assert_eq!(db.load_snapshot().unwrap(), Some(expected));
    }

    #[test]
    fn rejects_corrupt_snapshot_shape_without_overwriting_last_good_value() {
        let mut db = SnapshotDb::open_in_memory().unwrap();
        let expected = snapshot();
        db.save_snapshot(&expected).unwrap();
        assert!(db.save_snapshot(&serde_json::json!({"memos": []})).is_err());
        assert_eq!(db.load_snapshot().unwrap(), Some(expected));
    }
}
