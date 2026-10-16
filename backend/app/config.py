import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/newtonite"
    TEST_DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/newtonite_test"
    SECRET_KEY: str = "dev-secret-key-change-in-production-use-hs256"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    STALE_AFTER_HOURS: int = 72
    WORKER_POLL_INTERVAL_SECONDS: float = 2.0
    WORKER_BATCH_SIZE: int = 20

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


settings = Settings()
