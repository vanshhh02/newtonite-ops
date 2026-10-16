from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.exceptions import AppException
from app.api import auth, items

app = FastAPI(
    title="Newtonite Ops API",
    description="Internal Operations Management Backend",
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception Handlers matching API contract error envelope:
# {"error": {"code": "...", "message": "...", "details": ...}}
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    body = {
        "error": {
            "code": exc.code,
            "message": exc.message,
        }
    }
    if exc.details is not None:
        body["error"]["details"] = exc.details
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Missing required fields or invalid body/params
    fields = []
    for err in exc.errors():
        field_loc = " -> ".join(str(loc) for loc in err.get("loc", []))
        fields.append({
            "field": field_loc,
            "message": err.get("msg", ""),
            "type": err.get("type", ""),
        })

    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Request validation failed",
                "details": {"fields": fields},
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    code = "unauthenticated" if exc.status_code == 401 else "http_error"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": code,
                "message": str(exc.detail),
            }
        },
    )


# Include Routers
app.include_router(auth.router)
app.include_router(items.router)


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok"}
