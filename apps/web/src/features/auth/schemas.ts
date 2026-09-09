/**
 * Form schemas come from the shared @pm/validation package, so the rule the
 * browser enforces and the rule the API enforces are literally the same code.
 * The API remains authoritative; this is only for immediate feedback.
 */
export {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
} from '@pm/validation';
