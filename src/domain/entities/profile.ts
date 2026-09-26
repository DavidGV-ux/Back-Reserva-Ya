/**
 * Perfil complementario del usuario (se captura tras el registro web):
 * teléfono y ciudad, usados para personalizar el servicio y habilitar el
 * WhatsApp de ReservaYa. Se guarda localmente en el Back (fuera de Keycloak).
 */
export interface UserProfile {
  keycloakUserId: string;
  phone: string; // E.164 con + (ej. +573001234567)
  phoneDigits: string; // solo dígitos (clave canónica para el bot de WhatsApp)
  city: string;
  name?: string;
  email?: string;
  inviteSentAt?: string;
  updatedAt: string;
  createdAt: string;
}