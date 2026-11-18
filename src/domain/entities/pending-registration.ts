/**
 * Registro pendiente de verificación por WhatsApp.
 * Los datos NO se guardan en Keycloak ni en user_profiles hasta que el
 * usuario verifique su número enviando el código desde su WhatsApp.
 */
export interface PendingRegistration {
  id: string; // token de verificación (UUID)
  email: string;
  phone: string; // E.164 con + (ej. +573001234567)
  phoneDigits: string; // solo dígitos
  firstName: string;
  lastName: string;
  city: string;
  passwordEncrypted: string; // AES-256-GCM; nunca se guarda la contraseña en plano
  code?: string; // transitorio: solo para entregarlo por WhatsApp, NO se persiste
  codeHash: string; // hash SHA256 del código
  codeExpiresAt: string;
  createdAt: string;
  phoneVerified?: boolean;
  verificationAttempts?: number;
  updatedAt?: string;
  /** Se completa cuando el usuario de Keycloak y el perfil ya fueron creados. */
  completedAt?: string;
  keycloakUserId?: string;
}
