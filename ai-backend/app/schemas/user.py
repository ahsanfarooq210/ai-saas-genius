from pydantic import BaseModel, ConfigDict, EmailStr


class UserRead(BaseModel):
    id: int
    email: EmailStr
    full_name: str | None = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
