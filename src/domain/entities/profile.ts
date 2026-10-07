/**
 * Perfil complementario del usuario (se captura tras el registro web):
 * teléfono (obligatorio, dispara la bienvenida por WhatsApp) y ciudad
 * (opcional, personaliza el saludo). Se guarda localmente en el Back.
 */
export interface UserProfile {
  keycloakUserId: string;
  phone: string; // E.164 con + (ej. +573001234567)
  phoneDigits: string; // solo dígitos (clave canónica para el bot de WhatsApp)
  city?: string;
  name?: string;
  email?: string;
  inviteSentAt?: string;
  updatedAt: string;
  createdAt: string;
}