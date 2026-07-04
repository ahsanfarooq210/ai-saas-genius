export type SignUpRequest = {
  email: string;
  password: string;
  full_name?: string | null;
};

export type SignInRequest = {
  email: string;
  password: string;
};

export type RefreshTokenRequest = {
  refresh_token: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type UserResponse = {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
};
