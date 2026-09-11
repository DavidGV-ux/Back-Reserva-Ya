/**
 * ReservaYa — Script de creación de base de datos en MongoDB Atlas
 *
 * Ejecutar con mongosh:
 * mongosh "mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/reservaya" \
 *   --file setup-reservaya-atlas.js
 *
 * Diseño:
 * - Crea 16 colecciones.
 * - MongoDB no aplica claves foráneas: las Lambdas deben validar tenant_id,
 *   relaciones entre documentos y reglas de negocio.
 * - OCC se implementa en Lambdas mediante filtros { _id, version } y
 *   $inc: { version: 1 }. Declarar version aquí no implementa OCC por sí solo.
 * - ledger es append-only: los permisos insert/find sin update/delete deben
 *   configurarse en Atlas Database Access.
 * - audit_logs se alimenta desde Change Streams / Atlas Triggers y requiere
 *   un listener idempotente que use event_id estable.
 * - Los documentos archivados se exportan a Cloudflare R2 desde EventBridge
 *   + Lambda y luego se purgan mediante una Lambda controlada. No se usa TTL
 *   parcial en colecciones normales.
 *
 * Este script es de creación inicial. Si las colecciones ya existen,
 * db.createCollection() fallará. Para migraciones posteriores usar collMod,
 * createIndex y scripts de migración versionados.
 */

use("reservaya");

// ============================================================
// Helpers reutilizables para validadores
// ============================================================

const auditFields = {
  version: { bsonType: "int", minimum: 1 },
  created_by: { bsonType: "string", minLength: 1 },
  updated_by: { bsonType: "string", minLength: 1 },
  created_at: { bsonType: "date" },
  updated_at: { bsonType: "date" }
};

const softDeleteField = {
  deleted_at: { bsonType: ["date", "null"] }
};

const archiveFields = {
  archived: { bsonType: "bool" },
  archived_at: { bsonType: ["date", "null"] },
  archive_object_key: { bsonType: ["string", "null"] }
};

const providerSchema = {
  bsonType: "string",
  minLength: 2,
  maxLength: 64,
  pattern: "^[a-z0-9][a-z0-9_-]*$"
};

const moneySchema = {
  bsonType: "decimal",
  minimum: Decimal128("0")
};

const rateSchema = {
  bsonType: "decimal",
  minimum: Decimal128("0"),
  maximum: Decimal128("1")
};

// ============================================================
// 1. plans
// Colección global. No lleva tenant_id porque un plan puede servir
// a múltiples tenants.
// ============================================================

db.createCollection("plans", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "name",
        "commission_rate",
        "active",
        "version",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        name: { bsonType: "string", minLength: 1 },
        commission_rate: rateSchema,
        fixed_fee: moneySchema,
        active: { bsonType: "bool" },
        ...auditFields
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.plans.createIndex(
  { name: 1 },
  {
    unique: true,
    name: "uq_plans_name"
  }
);

// ============================================================
// 2. tenants
// ============================================================

db.createCollection("tenants", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "name",
        "plan_id",
        "timezone",
        "currency",
        "settings",
        "booking_status",
        "version",
        "created_by",
        "updated_by",
        "deleted_at",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        name: { bsonType: "string", minLength: 1 },
        plan_id: { bsonType: "objectId" },
        timezone: { bsonType: "string", minLength: 1 },
        currency: {
          bsonType: "string",
          enum: ["COP", "USD"]
        },
        settings: {
          bsonType: "object",
          required: [
            "slot_granularity_minutes",
            "cancellation_tolerance_hours",
            "payment_timeout_minutes",
            "advance_payment_percentage",
            "preferred_notification_channel"
          ],
          properties: {
            slot_granularity_minutes: {
              bsonType: "int",
              minimum: 5
            },
            cancellation_tolerance_hours: {
              bsonType: "int",
              minimum: 0
            },
            payment_timeout_minutes: {
              bsonType: "int",
              minimum: 1
            },
            advance_payment_percentage: {
              bsonType: "int",
              minimum: 0,
              maximum: 100
            },
            preferred_notification_channel: {
              bsonType: "string",
              enum: ["whatsapp", "email", "sms"]
            }
          }
        },
        booking_status: {
          bsonType: "string",
          enum: ["active", "suspended", "migration"]
        },
        ...auditFields,
        ...softDeleteField
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.tenants.createIndex(
  { tenant_id: 1 },
  {
    unique: true,
    name: "uq_tenants_tenant_id"
  }
);

db.tenants.createIndex(
  { deleted_at: 1 },
  {
    name: "idx_tenants_deleted_at"
  }
);

// ============================================================
// 3. services
// ============================================================

db.createCollection("services", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "name",
        "price",
        "duration_minutes",
        "active",
        "version",
        "created_by",
        "updated_by",
        "deleted_at",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        name: { bsonType: "string", minLength: 1 },
        description: { bsonType: "string" },
        price: moneySchema,
        duration_minutes: {
          bsonType: "int",
          minimum: 1
        },
        active: { bsonType: "bool" },
        ...auditFields,
        ...softDeleteField
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.services.createIndex(
  { tenant_id: 1, active: 1, deleted_at: 1 },
  {
    name: "idx_services_active_catalog"
  }
);

db.services.createIndex(
  { tenant_id: 1, name: 1 },
  {
    name: "idx_services_name"
  }
);

// ============================================================
// 4. professionals
// ============================================================

const workIntervalSchema = {
  bsonType: "object",
  required: ["start", "end"],
  properties: {
    start: {
      bsonType: "string",
      pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    },
    end: {
      bsonType: "string",
      pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    }
  }
};

db.createCollection("professionals", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "name",
        "services_ids",
        "schedule",
        "active",
        "version",
        "created_by",
        "updated_by",
        "deleted_at",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        name: { bsonType: "string", minLength: 1 },
        services_ids: {
          bsonType: "array",
          minItems: 1,
          items: { bsonType: "objectId" }
        },
        schedule: {
          bsonType: "object",
          properties: {
            monday: { bsonType: "array", items: workIntervalSchema },
            tuesday: { bsonType: "array", items: workIntervalSchema },
            wednesday: { bsonType: "array", items: workIntervalSchema },
            thursday: { bsonType: "array", items: workIntervalSchema },
            friday: { bsonType: "array", items: workIntervalSchema },
            saturday: { bsonType: "array", items: workIntervalSchema },
            sunday: { bsonType: "array", items: workIntervalSchema }
          }
        },
        active: { bsonType: "bool" },
        keycloak_user_id: { bsonType: ["string", "null"] },
        ...auditFields,
        ...softDeleteField
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.professionals.createIndex(
  { tenant_id: 1, active: 1, deleted_at: 1 },
  {
    name: "idx_professionals_active"
  }
);

db.professionals.createIndex(
  { tenant_id: 1, keycloak_user_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deleted_at: null,
      keycloak_user_id: { $type: "string" }
    },
    name: "uq_professionals_keycloak_active"
  }
);

// ============================================================
// 5. appointments
// payment_reference es opcional: se crea después de iniciar
// la orden de pago. El historial completo vive en
// payment_transactions.
// ============================================================

db.createCollection("appointments", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "professional_id",
        "service_id",
        "service_snapshot",
        "commission_rate_snapshot",
        "plan_id_snapshot",
        "source",
        "client_info",
        "start_time",
        "end_time",
        "status",
        "payment_status",
        "needs_reassignment",
        "version",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        professional_id: { bsonType: "objectId" },
        service_id: { bsonType: "objectId" },
        service_snapshot: {
          bsonType: "object",
          required: ["name", "price", "duration_minutes"],
          properties: {
            name: { bsonType: "string", minLength: 1 },
            price: moneySchema,
            duration_minutes: {
              bsonType: "int",
              minimum: 1
            }
          }
        },
        commission_rate_snapshot: rateSchema,
        plan_id_snapshot: { bsonType: "objectId" },
        idempotency_key: { bsonType: "string", minLength: 1 },
        source: {
          bsonType: "string",
          enum: ["web", "whatsapp", "admin"]
        },
        payment_reference: {
          bsonType: "string",
          minLength: 1
        },
        latest_payment_transaction_id: {
          bsonType: "objectId"
        },
        client_info: {
          bsonType: "object",
          required: [
            "name",
            "habeas_data_accepted_at"
          ],
          properties: {
            client_id: { bsonType: "string" },
            name: { bsonType: "string", minLength: 1 },
            phone: { bsonType: "string" },
            email: { bsonType: "string" },
            habeas_data_accepted_at: { bsonType: "date" },
            ip: { bsonType: "string" },
            user_agent: { bsonType: "string" }
          }
        },
        start_time: { bsonType: "date" },
        end_time: { bsonType: "date" },
        status: {
          bsonType: "string",
          enum: [
            "pending_payment",
            "confirmed",
            "completed",
            "no_show",
            "cancelled",
            "expired",
            "needs_reassignment"
          ]
        },
        payment_status: {
          bsonType: "string",
          enum: [
            "pending",
            "approved",
            "rejected",
            "refunded",
            "partially_refunded"
          ]
        },
        cancellation: {
          bsonType: "object",
          required: [
            "requested_by",
            "requested_at",
            "policy_applied",
            "processing_fee",
            "refund_amount",
            "refund_status"
          ],
          properties: {
            requested_by: {
              bsonType: "string",
              enum: [
                "client",
                "owner",
                "professional",
                "system"
              ]
            },
            requested_at: { bsonType: "date" },
            reason: { bsonType: "string" },
            policy_applied: {
              bsonType: "string",
              enum: [
                "client_within_window",
                "client_outside_window",
                "tenant_cancelled",
                "no_show",
                "system_cancelled"
              ]
            },
            processing_fee: moneySchema,
            refund_amount: moneySchema,
            refund_status: {
              bsonType: "string",
              enum: [
                "not_applicable",
                "pending",
                "approved",
                "failed"
              ]
            },
            refund_reference: { bsonType: "string" },
            resolved_at: { bsonType: "date" }
          }
        },
        needs_reassignment: { bsonType: "bool" },
        ...auditFields
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.appointments.createIndex(
  { tenant_id: 1, idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotency_key: { $exists: true }
    },
    name: "uq_appointments_idempotency"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, professional_id: 1, start_time: 1 },
  {
    name: "idx_appointments_professional_agenda"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, payment_reference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      payment_reference: { $exists: true }
    },
    name: "uq_appointments_payment_reference"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, latest_payment_transaction_id: 1 },
  {
    sparse: true,
    name: "idx_appointments_latest_payment"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, status: 1, payment_status: 1, created_at: 1 },
  {
    name: "idx_appointments_payment_expiry"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, "client_info.client_id": 1, start_time: -1 },
  {
    name: "idx_appointments_client_id_history"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, "client_info.phone": 1, start_time: -1 },
  {
    name: "idx_appointments_phone_history"
  }
);

db.appointments.createIndex(
  { tenant_id: 1, "client_info.email": 1, start_time: -1 },
  {
    name: "idx_appointments_email_history"
  }
);

// ============================================================
// 6. availability_blocks
// Documento principal para vacaciones, ausencias y bloqueos.
// Los slots derivados se insertan en time_slots.
// ============================================================

db.createCollection("availability_blocks", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "professional_id",
        "start_time",
        "end_time",
        "status",
        "version",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        professional_id: { bsonType: "objectId" },
        start_time: { bsonType: "date" },
        end_time: { bsonType: "date" },
        reason: { bsonType: "string" },
        status: {
          bsonType: "string",
          enum: ["active", "cancelled"]
        },
        ...auditFields
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.availability_blocks.createIndex(
  { tenant_id: 1, professional_id: 1, start_time: 1 },
  {
    name: "idx_availability_blocks_professional"
  }
);

// ============================================================
// 7. time_slots
//
// Regla de aplicación:
// occupation_type="appointment": appointment_id presente y block_id ausente.
// occupation_type="block": block_id presente y appointment_id ausente.
// El documento principal y sus slots se crean/eliminan en la
// misma transacción MongoDB.
// ============================================================

db.createCollection("time_slots", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "professional_id",
        "slot_start",
        "occupation_type",
        "created_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        professional_id: { bsonType: "objectId" },
        slot_start: { bsonType: "date" },
        occupation_type: {
          bsonType: "string",
          enum: ["appointment", "block"]
        },
        appointment_id: { bsonType: "objectId" },
        block_id: { bsonType: "objectId" },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.time_slots.createIndex(
  { tenant_id: 1, professional_id: 1, slot_start: 1 },
  {
    unique: true,
    name: "uq_time_slots_professional_start"
  }
);

db.time_slots.createIndex(
  { appointment_id: 1 },
  {
    sparse: true,
    name: "idx_time_slots_appointment"
  }
);

db.time_slots.createIndex(
  { block_id: 1 },
  {
    sparse: true,
    name: "idx_time_slots_block"
  }
);

// ============================================================
// 8. payment_transactions
//
// Historial técnico de operaciones con pasarelas:
// charge, refund, chargeback y payout.
//
// provider no usa enum cerrado para permitir nuevos adaptadores.
// La Lambda valida que el proveedor existe, está activo y tiene
// adaptador implementado.
// ============================================================

db.createCollection("payment_transactions", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "appointment_id",
        "provider",
        "operation",
        "internal_reference",
        "amount",
        "currency",
        "status",
        "version",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        appointment_id: { bsonType: "objectId" },
        provider: providerSchema,
        provider_transaction_id: { bsonType: "string" },
        provider_event_id: { bsonType: "string" },
        internal_reference: { bsonType: "string", minLength: 1 },
        operation: {
          bsonType: "string",
          enum: ["charge", "refund", "chargeback", "payout"]
        },
        amount: moneySchema,
        currency: {
          bsonType: "string",
          enum: ["COP", "USD"]
        },
        status: {
          bsonType: "string",
          enum: [
            "pending",
            "approved",
            "declined",
            "failed",
            "refunded",
            "partially_refunded"
          ]
        },
        metadata: { bsonType: "object" },
        ...auditFields
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.payment_transactions.createIndex(
  { tenant_id: 1, internal_reference: 1 },
  {
    unique: true,
    name: "uq_payment_transactions_internal_reference"
  }
);

db.payment_transactions.createIndex(
  { provider: 1, provider_transaction_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      provider_transaction_id: { $exists: true }
    },
    name: "uq_payment_transactions_provider_transaction"
  }
);

db.payment_transactions.createIndex(
  { provider: 1, provider_event_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      provider_event_id: { $exists: true }
    },
    name: "uq_payment_transactions_provider_event"
  }
);

db.payment_transactions.createIndex(
  { tenant_id: 1, appointment_id: 1, created_at: -1 },
  {
    name: "idx_payment_transactions_appointment"
  }
);

// ============================================================
// 9. ledger
//
// Append-only. Los permisos de Atlas deben impedir update/delete.
// payment_rejected es un evento neutro: amount=0,
// account="payment_event", direction="neutral".
// ============================================================

db.createCollection("ledger", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "transaction_id",
        "type",
        "account",
        "direction",
        "amount",
        "currency",
        "status",
        "timestamp"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        transaction_id: { bsonType: "string", minLength: 1 },
        appointment_id: { bsonType: "objectId" },
        payout_id: { bsonType: "objectId" },
        payment_transaction_id: { bsonType: "objectId" },
        payment_reference: { bsonType: "string" },
        type: {
          bsonType: "string",
          enum: [
            "payment_approved",
            "payment_rejected",
            "platform_commission",
            "tenant_credit",
            "refund",
            "processing_fee",
            "payout_weekly",
            "balance_adjustment"
          ]
        },
        account: {
          bsonType: "string",
          enum: [
            "tenant_balance",
            "platform_revenue",
            "customer_refund_liability",
            "payout_liability",
            "payment_event"
          ]
        },
        direction: {
          bsonType: "string",
          enum: ["credit", "debit", "neutral"]
        },
        amount: moneySchema,
        currency: {
          bsonType: "string",
          enum: ["COP", "USD"]
        },
        commission_rate_snapshot: rateSchema,
        status: {
          bsonType: "string",
          enum: ["pending", "posted", "reversed", "failed"]
        },
        idempotency_key: { bsonType: "string" },
        source: { bsonType: "string" },
        source_event_id: { bsonType: "string" },
        metadata: { bsonType: "object" },
        timestamp: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.ledger.createIndex(
  { transaction_id: 1 },
  {
    unique: true,
    name: "uq_ledger_transaction_id"
  }
);

db.ledger.createIndex(
  { tenant_id: 1, timestamp: 1 },
  {
    name: "idx_ledger_tenant_timestamp"
  }
);

db.ledger.createIndex(
  { tenant_id: 1, appointment_id: 1, timestamp: 1 },
  {
    name: "idx_ledger_appointment"
  }
);

db.ledger.createIndex(
  { tenant_id: 1, payout_id: 1, timestamp: 1 },
  {
    sparse: true,
    name: "idx_ledger_payout"
  }
);

db.ledger.createIndex(
  { tenant_id: 1, payment_transaction_id: 1, timestamp: 1 },
  {
    sparse: true,
    name: "idx_ledger_payment_transaction"
  }
);

db.ledger.createIndex(
  { tenant_id: 1, idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotency_key: { $exists: true }
    },
    name: "uq_ledger_idempotency"
  }
);

// ============================================================
// 10. whatsapp_conversations
// ============================================================

db.createCollection("whatsapp_conversations", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "conversation_id",
        "tenant_id",
        "phone",
        "whatsapp_message_id",
        "status",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        conversation_id: { bsonType: "string", minLength: 1 },
        tenant_id: { bsonType: "string", minLength: 1 },
        phone: { bsonType: "string", minLength: 1 },
        whatsapp_message_id: { bsonType: "string", minLength: 1 },
        intent: { bsonType: "string" },
        payload: { bsonType: "object" },
        appointment_id: { bsonType: "objectId" },
        status: {
          bsonType: "string",
          enum: [
            "received",
            "processing",
            "waiting_customer",
            "payment_pending",
            "completed",
            "failed",
            "redirected_to_web"
          ]
        },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.whatsapp_conversations.createIndex(
  { conversation_id: 1 },
  {
    unique: true,
    name: "uq_whatsapp_conversations_conversation"
  }
);

db.whatsapp_conversations.createIndex(
  { whatsapp_message_id: 1 },
  {
    unique: true,
    name: "uq_whatsapp_conversations_message"
  }
);

db.whatsapp_conversations.createIndex(
  { tenant_id: 1, phone: 1, created_at: -1 },
  {
    name: "idx_whatsapp_conversations_client"
  }
);

// ============================================================
// 11. notifications
//
// Los reintentos actualizan el mismo documento, incrementando attempts.
// Si necesitas persistir cada intento individual, crea una colección
// notification_attempts en una evolución posterior.
// ============================================================

db.createCollection("notifications", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "appointment_id",
        "channel",
        "type",
        "status",
        "attempts",
        "archived",
        "created_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: { bsonType: "string", minLength: 1 },
        appointment_id: { bsonType: "objectId" },
        channel: {
          bsonType: "string",
          enum: ["whatsapp", "email", "sms"]
        },
        type: {
          bsonType: "string",
          enum: ["confirmation", "reminder", "cancellation"]
        },
        status: {
          bsonType: "string",
          enum: ["pending", "sent", "failed", "fallback_sent"]
        },
        provider_message_id: { bsonType: "string" },
        attempts: {
          bsonType: "int",
          minimum: 0
        },
        last_error: { bsonType: "string" },
        ...archiveFields,
        created_at: { bsonType: "date" },
        sent_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.notifications.createIndex(
  { tenant_id: 1, appointment_id: 1, type: 1, channel: 1 },
  {
    unique: true,
    name: "uq_notifications_appointment_type_channel"
  }
);

db.notifications.createIndex(
  { status: 1, created_at: 1 },
  {
    name: "idx_notifications_delivery_queue"
  }
);

db.notifications.createIndex(
  { archived: 1, created_at: 1 },
  {
    name: "idx_notifications_archival"
  }
);

// ============================================================
// 12. audit_logs
//
// tenant_id es opcional: las operaciones de plans y platform_users
// son globales y no pertenecen a un tenant.
// event_id debe ser estable y derivado del evento Change Stream.
// ============================================================

db.createCollection("audit_logs", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "event_id",
        "collection",
        "document_id",
        "operation",
        "actor",
        "archived",
        "timestamp"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        event_id: { bsonType: "string", minLength: 1 },
        tenant_id: {
          bsonType: ["string", "null"]
        },
        collection: { bsonType: "string", minLength: 1 },
        document_id: { bsonType: "objectId" },
        operation: {
          bsonType: "string",
          enum: ["insert", "update", "replace", "delete"]
        },
        actor: { bsonType: "string", minLength: 1 },
        before: {
          bsonType: ["object", "null"]
        },
        after: {
          bsonType: ["object", "null"]
        },
        resume_token: { bsonType: "object" },
        ...archiveFields,
        timestamp: { bsonType: "date" }
      }
    }
  },
  validationLevel: "moderate",
  validationAction: "error"
});

db.audit_logs.createIndex(
  { event_id: 1 },
  {
    unique: true,
    name: "uq_audit_logs_event"
  }
);

db.audit_logs.createIndex(
  { tenant_id: 1, collection: 1, document_id: 1, timestamp: -1 },
  {
    name: "idx_audit_logs_document_history"
  }
);

db.audit_logs.createIndex(
  { actor: 1, timestamp: -1 },
  {
    name: "idx_audit_logs_actor_history"
  }
);

db.audit_logs.createIndex(
  { archived: 1, timestamp: 1 },
  {
    name: "idx_audit_logs_archival"
  }
);

// ============================================================
// 13. platform_users
// Administradores globales. No pertenecen a un tenant.
// ============================================================

db.createCollection("platform_users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "keycloak_user_id",
        "role",
        "status",
        "synced_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        keycloak_user_id: {
          bsonType: "string",
          minLength: 1
        },
        role: {
          bsonType: "string",
          enum: ["admin"]
        },
        status: {
          bsonType: "string",
          enum: ["active", "revoked"]
        },
        synced_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.platform_users.createIndex(
  { keycloak_user_id: 1 },
  {
    unique: true,
    name: "uq_platform_users_keycloak"
  }
);

// ============================================================
// 14. tenant_users
//
// Un usuario puede tener distintos roles en el mismo tenant.
// Por ejemplo, owner y professional.
// ============================================================

db.createCollection("tenant_users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "keycloak_user_id",
        "role",
        "status",
        "synced_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: {
          bsonType: "string",
          minLength: 1
        },
        keycloak_user_id: {
          bsonType: "string",
          minLength: 1
        },
        role: {
          bsonType: "string",
          enum: ["owner", "professional", "client"]
        },
        status: {
          bsonType: "string",
          enum: ["active", "revoked"]
        },
        synced_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.tenant_users.createIndex(
  { tenant_id: 1, keycloak_user_id: 1, role: 1 },
  {
    unique: true,
    name: "uq_tenant_users_membership_role"
  }
);

// ============================================================
// 15. payout_accounts
// Las cuentas se almacenan tokenizadas, no como números bancarios.
// ============================================================

db.createCollection("payout_accounts", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "provider",
        "account_type",
        "account_token",
        "account_last4",
        "currency",
        "verification_status",
        "is_default",
        "version",
        "created_by",
        "updated_by",
        "deleted_at",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: {
          bsonType: "string",
          minLength: 1
        },
        provider: providerSchema,
        account_type: {
          bsonType: "string",
          enum: ["bank_account", "digital_wallet"]
        },
        account_token: {
          bsonType: "string",
          minLength: 1
        },
        account_last4: {
          bsonType: "string",
          pattern: "^[0-9]{4}$"
        },
        currency: {
          bsonType: "string",
          enum: ["COP", "USD"]
        },
        verification_status: {
          bsonType: "string",
          enum: ["pending", "verified", "rejected"]
        },
        is_default: { bsonType: "bool" },
        ...auditFields,
        ...softDeleteField
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.payout_accounts.createIndex(
  { tenant_id: 1, is_default: 1 },
  {
    unique: true,
    partialFilterExpression: {
      is_default: true,
      deleted_at: null
    },
    name: "uq_payout_accounts_default"
  }
);

db.payout_accounts.createIndex(
  { tenant_id: 1, provider: 1, account_token: 1 },
  {
    unique: true,
    name: "uq_payout_accounts_token"
  }
);

// ============================================================
// 16. payouts
//
// Formula de dominio que debe validar la Lambda:
// net_amount = gross_amount - commission_amount - refund_amount - debt_amount
// Los valores se guardan no negativos; el resultado neto debe ser >= 0.
// ============================================================

db.createCollection("payouts", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "tenant_id",
        "payout_account_id",
        "provider",
        "period_start",
        "period_end",
        "gross_amount",
        "commission_amount",
        "refund_amount",
        "debt_amount",
        "net_amount",
        "currency",
        "status",
        "version",
        "created_by",
        "updated_by",
        "requested_at",
        "created_at",
        "updated_at"
      ],
      properties: {
        _id: { bsonType: "objectId" },
        tenant_id: {
          bsonType: "string",
          minLength: 1
        },
        payout_account_id: { bsonType: "objectId" },
        provider: providerSchema,
        period_start: { bsonType: "date" },
        period_end: { bsonType: "date" },
        gross_amount: moneySchema,
        commission_amount: moneySchema,
        refund_amount: moneySchema,
        debt_amount: moneySchema,
        net_amount: moneySchema,
        currency: {
          bsonType: "string",
          enum: ["COP", "USD"]
        },
        status: {
          bsonType: "string",
          enum: [
            "pending",
            "processing",
            "completed",
            "failed",
            "cancelled"
          ]
        },
        provider_reference: { bsonType: "string" },
        requested_at: { bsonType: "date" },
        completed_at: { bsonType: "date" },
        ...auditFields
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.payouts.createIndex(
  { tenant_id: 1, period_start: 1, period_end: 1 },
  {
    unique: true,
    name: "uq_payouts_tenant_period"
  }
);

db.payouts.createIndex(
  { tenant_id: 1, status: 1, created_at: -1 },
  {
    name: "idx_payouts_status"
  }
);

db.payouts.createIndex(
  { provider: 1, provider_reference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      provider_reference: { $exists: true }
    },
    name: "uq_payouts_provider_reference"
  }
);

// ============================================================
// Pre/post-imágenes para colecciones mutables que se auditan.
// Change Streams puede usar pre/post imágenes cuando están habilitadas.
// ============================================================

[
  "plans",
  "tenants",
  "services",
  "professionals",
  "appointments",
  "availability_blocks",
  "payment_transactions",
  "payout_accounts",
  "payouts"
].forEach((collectionName) => {
  db.runCommand({
    collMod: collectionName,
    changeStreamPreAndPostImages: {
      enabled: true
    }
  });
});

print("✅ Base de datos 'reservaya' creada con 16 colecciones, validadores e índices.");