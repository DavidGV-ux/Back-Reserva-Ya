# Reflexión del equipo · Primer pipeline de CI

**Proyecto:** ReservaYa · Ingeniería de Software I · UPTC Sogamoso
**Fecha:** 26 de octubre de 2026

## 1. ¿Qué problema concreto evita un pipeline de CI cuando varias personas trabajan sobre el mismo código?

Evita que los cambios de varias ramas se integren solo al final y que los errores aparezcan en la entrega. En ReservaYa el backend tiene reglas críticas de reservas y pagos (`booking-rules.ts`, `payments-rules.ts`) y 38 pruebas automatizadas (unitarias y de integración); si una persona cambia una regla y otra modifica su prueba, el check `build-and-test` lo detecta en el PR antes de llegar a `main`. Sin CI, ese choque se descubriría al ejecutar todo manualmente o al probar la aplicación completa, cuando ya es más costoso corregirlo.

## 2. ¿Qué error detectó el check en el Paso 3 y cómo lo habrían descubierto sin automatización?

El PR #3 incluyó un cambio intencional para romper el pipeline. La ejecución roja quedó registrada con `AssertionError: expected [] to include 'backup-2026-09-20.bin'` en `test/unit/apply-retention.test.ts`; el job `build-and-test` falló en 39 segundos y GitHub bloqueó el merge. Después se corrigió la fecha de la prueba y el mismo PR quedó en verde. Sin automatización, alguien tendría que recordar ejecutar `npm test` en su máquina antes de subir el cambio, o el error aparecería en una revisión manual o en la demo del proyecto. La diferencia es que el pipeline no depende de que alguien se acuerde: se ejecuta siempre y deja el log adjunto al PR.

## 3. ¿A qué escenario de calidad de la Semana 6 (por ejemplo, mantenibilidad o confiabilidad) ayuda este pipeline y por qué?

Ayuda principalmente a la **confiabilidad**, porque cada cambio en las reglas de reservas, cancelaciones y pagos se compila y se prueba antes de fusionarse. También mejora la **mantenibilidad**: el proyecto debe seguir pasando `npm run typecheck` y las 38 pruebas automatizadas, y el workflow deja explícitos los comandos para reproducir el CI. En la práctica, `npm run typecheck` detecta errores de tipos en el dominio y `vitest` protege cálculos como el anticipo de una reserva (`computeAdvance`), que son difíciles de revisar a simple vista.

## 4. ¿Qué no valida hoy su pipeline? Mencionen al menos dos cosas.

El pipeline del Back sí levanta MongoDB 7 como replica set y ejecuta las pruebas de integración (`test/integration/booking.test.ts`, `create-backup.test.ts`, `onboarding.test.ts`, `tenants.test.ts`), así que esas sí están cubiertas. No valida:

- El **frontend Angular** (`Front-ReservaYa`), que está en otro repositorio: no se ejecuta `ng build` ni sus pruebas.
- La **integración real con Keycloak, WhatsApp/Resend y las pasarelas de pago**, porque el workflow solo levanta MongoDB y esas integraciones se prueban con mocks o no se cubren de extremo a extremo.
- El **análisis de seguridad y estático** (`npm audit`, ESLint/CodeQL).
- El **empaquetado de producción** (`npm run build`/Lambda) y el **despliegue**; todo eso queda como trabajo futuro.

## 5. ¿Qué agregarían primero: pruebas automatizadas, análisis de código o despliegue automático? Justifiquen la elección.

Agregaríamos primero **pruebas automatizadas**, empezando por pruebas E2E del frontend y flujos completos de reserva y pago, y después sumar `ng build` y pruebas del frontend. La razón es que el despliegue automático sin una suite confiable solo aceleraría la publicación de errores; el análisis de código es valioso, pero no reemplaza probar el comportamiento real de reservas y pagos. Con la suite completa en verde, sí tendría sentido agregar ESLint/CodeQL y luego un despliegue automático a un entorno de staging.

---

### Evidencia del flujo rojo → verde

- PR con el error intencional y su corrección: <https://github.com/DavidGV-ux/Back-Reserva-Ya/pull/3>
- Run rojo: <https://github.com/DavidGV-ux/Back-Reserva-Ya/actions/runs/40339954533>
- Run verde: <https://github.com/DavidGV-ux/Back-Reserva-Ya/actions/runs/40341240996>
- Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
