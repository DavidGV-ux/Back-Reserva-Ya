# ADR-12 · Integración de pasarelas de pago

**Alcance de la decisión** · Fase 1. Wompi en sandbox es el proveedor previsto por RF-5.1. El proveedor efectivo de la demostración se registra en AM-01. [RES-34](https://linear.app/reservaya/issue/RES-34)

## Contexto

La aprobación del anticipo debe actualizar la cita y producir un efecto contable verificable. Los casos de uso necesitan operar con la misma interfaz al cambiar de proveedor o ejecutar pruebas simuladas.

## Decisión

El caso de uso delega las operaciones de la pasarela en `PaymentGatewayProvider`. Back selecciona el adaptador con `PAYMENT_PROVIDER`. El código de referencia incluye Wompi, PayU y un proveedor simulado. `WOMPI_ENVIRONMENT` figura con el valor predeterminado `test` en la configuración versionada. [Puerto de pagos](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/src/domain/ports/gateways.ts) · [Configuración de Back](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/serverless.yml)

El backend vincula la respuesta de la pasarela con la referencia interna del pago. Una aprobación confirma la cita y genera los asientos correspondientes. La confirmación habilita el flujo de avisos. La misma aprobación reenviada conserva un único efecto contable. El caso de integración de Wompi también comprueba que un evento cuyo pago sigue pendiente conserva el estado de la cita. [Casos de integración de pasarelas](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/payments-providers.test.ts)

## Alternativas y consecuencias

Una integración directa en el caso de uso acoplaría la lógica de la reserva y del libro contable al proveedor. El puerto permite incorporar adaptadores y repetir pruebas controladas. Los adaptadores externos requieren validación en el ambiente donde se usan.

La CI del 18 de noviembre de 2026 pasó ocho pruebas de integración de Wompi y PayU. En el entorno de entrega queda pendiente registrar proveedor y modo, referencia de prueba, transición de la cita y asientos resultantes. Registrar la regla de reembolso acordada en AM-01 con el resultado de sandbox. [Corrida de CI](https://github.com/DavidGV-ux/Back-Reserva-Ya/actions/runs/44246667139) · [AM-01](../Actas/AM-01_consolidacion-cierre.md)
