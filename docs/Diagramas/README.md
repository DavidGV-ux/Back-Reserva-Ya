# Diagramas editables de ReservaYa

Cada diagrama tiene una fuente `.mmd` y una vista previa en Mermaid. Los diagramas describen la versión de referencia. Los resultados observados y su alcance están en el [informe de pruebas](../Pruebas/evidencia-ci.md).

## Despliegue AWS

```mermaid
flowchart TD
  subgraph Web["Portal web"]
    CF["CloudFront"]
    S3["S3 · activos"]
    SSR["Lambda · Angular SSR"]
    CF --> S3
    CF --> SSR
  end
  subgraph Backend["API de reservas"]
    GW["API Gateway"]
    API["Lambda · API"]
    DB["MongoDB Atlas"]
    GW --> API --> DB
  end
  subgraph Chat["Canal WhatsApp"]
    Meta["Meta WhatsApp"]
    WH["Webhook del bot"]
    SQS["Cola SQS"]
    BOT["Procesador de mensajes"]
    IA["Proveedor de IA"]
    Meta --> WH --> SQS --> BOT
    BOT --> IA
  end
  subgraph Identity["Identidad"]
    KC["Keycloak en EC2"]
    PG["PostgreSQL"]
    KC --> PG
  end
  SSR --> GW
  CF -. OIDC .-> KC
  BOT --> GW
  API --> PAY["Pasarela de pagos"]
```

La topología web, de Back e identidad toma como referencia el comparativo de David Galvis, página 3. El canal de reservas por WhatsApp sigue el ADR-14 y el servicio de la rama `Fernando`, que documenta la ruta Meta, SQS y Back. La versión del bot que atiende el número de la demo queda por confirmar. [ADR-14](../ADR-14-consolidacion-whatsapp-legacy-fyn.md) · [Servicio conversacional](https://github.com/DavidGV-ux/ReservaYa-Whatsapp/blob/Fernando/package.json)

## Modelo de datos MongoDB

```mermaid
erDiagram
  tenants ||--o{ services : ofrece
  tenants ||--o{ professionals : administra
  tenants ||--o{ tenant_users : vincula
  tenants ||--o{ appointments : agrupa
  services ||--o{ appointments : se_reserva_en
  professionals ||--o{ appointments : atiende
  professionals ||--o{ availability_blocks : tiene
  professionals ||--o{ time_slots : agenda
  appointments o|--o{ time_slots : ocupa
  availability_blocks o|--o{ time_slots : bloquea
  appointments ||--o{ payment_transactions : registra
  appointments ||--o{ notifications : origina
  appointments o|--o{ ledger : referencia
  appointments o|--o{ whatsapp_conversations : vincula
```

El diagrama muestra las referencias de aplicación entre las colecciones principales. Cada franja pertenece a un profesional y puede referenciar una cita o un bloque de disponibilidad según su tipo. [Script de inicialización de MongoDB](https://github.com/DavidGV-ux/Modelo-de-datos-Reserva-Ya/blob/main/Codigo/Back/scripts/schema/setup-reservaya-atlas.js)

## Casos de uso web

```mermaid
flowchart TD
  subgraph Portal["Portal público y cliente"]
    Guest["Invitado"] --> Booking["Consultar disponibilidad y reservar"]
    Client["Cliente"] --> Booking
    Client --> History["Consultar y gestionar sus citas"]
  end
  subgraph Panel["Operación del negocio"]
    Owner["Dueño"] --> Catalog["Gestionar catálogo y profesionales"]
    Owner --> Reports["Consultar reportes"]
    Professional["Profesional"] --> Agenda["Gestionar su agenda"]
    Owner --> Agenda
  end
  Admin["Admin de plataforma"] --> Tenants["Gestionar negocios"]
```

El diagrama muestra los objetivos principales de cada rol en el portal y el panel. El SRS desarrolla las condiciones de acceso, consentimiento y pago. [SRS v2](../SRS/SRS-v2.md)

## Secuencia del pago del anticipo

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Portal
  participant B as Backend
  participant P as Pasarela sandbox
  participant M as MongoDB
  C->>W: Confirmar datos y consentimiento
  W->>B: Crear reserva
  B->>M: Guardar cita pendiente y bloquear horario
  B->>P: Iniciar anticipo
  B-->>W: Entregar enlace de pago
  C->>P: Completar pago de prueba
  P->>B: Informar resultado
  alt Pago aprobado
    B->>M: Confirmar cita y registrar efecto contable
  else Pago sin aprobación
    B->>B: Conservar la cita sin confirmar
  end
  W->>B: Consultar estado de la cita
  B-->>W: Devolver estado registrado
```

El flujo ilustra el pago alojado en sandbox. El portal consulta el estado registrado por Back después de que Back procesa el resultado de la pasarela. La prueba de Wompi cubre el pago aprobado y la deduplicación de una aprobación reenviada. [Pruebas de pasarelas](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/payments-providers.test.ts)

## Secuencia de expiración

```mermaid
sequenceDiagram
  participant S as Programador
  participant B as Backend
  participant M as MongoDB
  participant W as Portal
  S->>B: Ejecutar ronda de expiración
  B->>M: Buscar citas pendientes vencidas
  alt La cita sigue pendiente
    B->>M: Marcar expirada y liberar franja
    W->>B: Consultar disponibilidad
    B-->>W: Mostrar franja libre
  else La cita ya cambió de estado
    B->>M: Conservar el estado registrado
  end
```

La configuración de referencia ejecuta el trabajo cada cinco minutos. El vencimiento de una cita depende del plazo de pago configurado. La disponibilidad se consulta después de que el trabajo libera la franja. [Configuración de Back](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/serverless.yml)

## Secuencia de notificación

```mermaid
sequenceDiagram
  participant B as Backend
  participant N as Servicio de avisos
  participant WA as WhatsApp
  participant A as Correo Resend
  actor C as Cliente
  B->>N: Procesar confirmación, cancelación o recordatorio
  alt WhatsApp es el canal configurado
    N->>WA: Solicitar envío
    WA-->>N: Informar resultado del intento
    alt Solicitud aceptada
      WA-->>C: Tramitar aviso
    else Fallo con respaldo por correo habilitado
      N->>A: Solicitar envío alternativo
      A-->>N: Informar resultado del intento
    end
  else Resend es el canal configurado
    N->>A: Solicitar envío por correo
    A-->>N: Informar resultado del intento
  end
  opt Correo aceptado para envío
    A-->>C: Tramitar aviso
  end
  N->>N: Registrar intento y resultado
```

El resultado registrado corresponde al intento de envío. La integración de Back comprueba el respaldo por correo bajo condiciones de prueba. El canal efectivo y la recepción por el cliente se verifican en el entorno de entrega. [Prueba de notificaciones y recordatorios](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/notifications-reminders.test.ts)

## Archivos fuente

[despliegue-aws.mmd](despliegue-aws.mmd) · [modelo-mongodb.mmd](modelo-mongodb.mmd) · [casos-de-uso.mmd](casos-de-uso.mmd) · [secuencia-pago.mmd](secuencia-pago.mmd) · [secuencia-expiracion.mmd](secuencia-expiracion.mmd) · [secuencia-notificacion.mmd](secuencia-notificacion.mmd)
