# ReservaYa · Especificación de requisitos del software

**Versión documental 2.0 · Fase 1 · 20 de noviembre de 2026**  
**Estado documental** · Consolidada para revisión de aceptación.

## 1. Propósito y alcance

ReservaYa permite que varios negocios de servicios administren citas desde una misma plataforma, con aislamiento de datos por negocio. La Fase 1 cubre el alta asistida, la publicación de servicios y disponibilidad, la reserva web y por WhatsApp, el cobro de anticipos, la gestión de citas por rol, los avisos y el registro del saldo del negocio.

El saldo y los movimientos se registran en el libro contable interno. La transferencia bancaria automatizada, la verificación del método de cobro para esa transferencia y la gestión de saldos negativos por liquidación corresponden a la Fase 2. La pasarela definida para la validación de Fase 1 es Wompi en sandbox, según RF-5.1.

Las secciones 3 a 5 conservan los requisitos y reglas de la línea base 1.1. La sección 7 registra la evidencia disponible y las diferencias que deben resolverse antes de formalizar la aceptación de la versión entregada.

## 2. Contexto del sistema

### Usuarios y acceso

| Usuario o rol | Operación prevista |
| --- | --- |
| Visitante | Consulta el portal público, selecciona una franja y puede reservar como invitado con los datos y el consentimiento requeridos. |
| Cliente | Consulta y gestiona sus citas según la política de cancelación o reprogramación del negocio. |
| Dueño | Configura el negocio, administra servicios y profesionales y consulta agenda, reportes y movimientos de su negocio. |
| Profesional | Gestiona su disponibilidad y las citas que tiene asignadas. |
| Administrador de plataforma | Opera el alta asistida de negocios, la configuración general y las funciones de supervisión y auditoría. |

### Interfaces externas

| Componente | Función en el alcance de Fase 1 |
| --- | --- |
| Keycloak mediante OpenID Connect | Autenticación de usuarios y emisión de la credencial que el sistema usa para resolver identidad, rol y negocio. |
| MongoDB Atlas | Persistencia de negocios, catálogo, horarios, citas, transacciones, notificaciones y registros de auditoría. |
| Wompi en sandbox | Procesamiento del anticipo y sus devoluciones según la política aplicable. ReservaYa recibe el resultado y lo vincula con la cita y el libro contable. |
| WhatsApp Business Cloud API de Meta | Canal de confirmaciones, recordatorios y reservas por conversación. |
| Correo electrónico o SMS | Canales alternativos previstos para los avisos. El entorno de aceptación debe identificar el canal disponible. |
| Cloudflare R2 | Destino previsto para el archivo de registros históricos de notificaciones y auditoría. La [decisión de respaldos](../ADR-13-backups-monitoreo.md) documenta por separado las copias de base de datos y su retención. |

### Términos

- **Negocio (tenant).** Unidad que opera con su propia configuración, datos y permisos.
- **Franja horaria.** Intervalo de disponibilidad de un recurso para un servicio.
- **Anticipo.** Importe que se paga para confirmar una cita según la política aplicable.
- **Libro contable interno (ledger).** Registro de movimientos, comisiones y saldos por negocio.
- **Sandbox.** Entorno de pruebas del proveedor para verificar transacciones.
- **Webhook.** Evento que un servicio externo envía al sistema, por ejemplo para informar el resultado de un pago.

## 3. Requisitos funcionales

La prioridad de la línea base se presenta como **Must** (obligatorio), **Should** (importante) o **Could** (deseable).

### 3.1 Núcleo

| ID | Requisito | Actor | Prioridad |
| --- | --- | --- | --- |
| RF-1.1 | El sistema debe representar cualquier negocio mediante el modelo genérico "recurso-servicio-turno", sin tablas ni lógica exclusiva por vertical de negocio. | Sistema | Must |
| RF-1.2 | El sistema debe rechazar cualquier intento de reserva que se solape con una reserva existente para el mismo recurso y franja horaria. | Sistema | Must |
| RF-1.3 | El sistema debe almacenar toda fecha/hora de reserva en UTC y convertirla a la zona horaria del tenant o del cliente al mostrarla. | Sistema | Must |
| RF-1.4 | El sistema debe resolver e incluir el identificador de tenant, idioma,moneda y región en cada solicitud (request) al backend. | Sistema | Must |
| RF-1.5 | El sistema debe externalizar todos los textos de interfaz y notificaciones en archivos de traducción por idioma, sin cadenas de texto embebidas en el código. | Equipo de desarrollo | Must |
| RF-1.6 | El sistema debe permitir activar o desactivar un idioma o una moneda mediante configuración del tenant, sin requerir despliegue de código nuevo. | Dueño / Administrador de plataforma | Should |
| RF-1.7 | El sistema debe autenticar usuarios y autorizar sus acciones según los cuatro roles del sistema: administrador de plataforma, dueño, profesional y cliente final. | Administrador de plataforma, Dueño, profesional,cliente | Must |
| RF-1.8 | El sistema debe permitir el alta de un nuevo tenant mediante un formulario de registro asistido, capturando nombre del negocio, zona horaria, idioma y moneda inicial; el aprovisionamiento self-service completo queda fuera de Fase 1 para evitar sobre-ingeniería. | Dueño (nuevo) / Equipo de soporte | Should |
| RF-1.9 | El sistema debe delegar la autenticación de todos sus usuarios en un proveedor de identidad externo (Keycloak, mediante OpenID Connect): no debe almacenar contraseñas en ninguna de sus colecciones, y debe resolver la identidad del usuario, su rol y el tenant al que pertenece exclusivamente a partir de los claims del token (JWT) recibido, conservando únicamente el identificador de usuario del proveedor y el rol asignado dentro de cada negocio. | Sistema / Todos los usuarios | Must |
| RF-1.10 | El sistema debe permitir consultar el registro de auditoría de los cambios sobre datos críticos, filtrable por colección, documento, actor y rango de fechas; el administrador de plataforma accede a todos los registros y el dueño únicamente a los registros de su propio tenant. | Administrador de plataforma / Dueño | Should |

### 3.2 Gestión administrativa

| ID | Requisito | Actor | Prioridad |
| --- | --- | --- | --- |
| RF-2.1 | El sistema debe permitir al dueño configurar la zona horaria y la moneda de cobro de su negocio. | Dueño | Must |
| RF-2.2 | El sistema debe permitir crear, editar y eliminar servicios del catálogo, especificando nombre, duración en minutos y precio en la moneda del tenant. | Dueño | Must |
| RF-2.3 | El sistema debe permitir registrar profesionales (recursos), asignarles horarios de trabajo y los servicios que pueden prestar. | Dueño | Must |
| RF-2.4 | El sistema debe permitir bloquear fechas u horarios específicos para que no aparezcan disponibles en el portal del cliente. | Dueño / Profesional | Must |
| RF-2.5 | El sistema debe generar un panel de analítica con ocupación (%), servicios más solicitados, desempeño por profesional y tasa de inasistencias (no-shows), filtrable por rango de fechas. | Dueño | Must |
| RF-2.6 | El sistema debe permitir al profesional o al dueño marcar el estado final de cada cita como "asistió", "no asistió" o "cancelada". | Profesional / Dueño | Must |
| RF-2.7 | El sistema debe permitir al dueño dar de alta o revocar el acceso de un profesional con cuenta propia. | Dueño | Must |
| RF-2.8 | El sistema debe permitir configurar con cuántas horas de anticipación se envía el recordatorio automático de cita. | Dueño | Could |
| RF-2.9 | El sistema debe mostrar al dueño su saldo acumulado, la comisión retenida por la plataforma y el detalle de los movimientos contables del periodo, filtrables por rango de fechas, calculados mediante agregación sobre el libro contable interno (ledger). | Dueño | Must |

### 3.3 Portal del cliente y reservas

| ID | Requisito | Actor | Prioridad |
| --- | --- | --- | --- |
| RF-3.1 | El sistema debe mostrar al cliente la disponibilidad en tiempo real de un servicio/profesional, convertida a la zona horaria detectada del dispositivo del cliente. | Cliente | Must |
| RF-3.2 | El sistema debe permitir al cliente completar una reserva con nombre, teléfono/correo y servicio seleccionado, ya sea con cuenta registrada o como invitado. | Cliente | Must |
| RF-3.2b | El sistema debe presentar una casilla de aceptación explícita de tratamiento de datos personales (Habeas Data) en todo formulario que capture datos del cliente, bloqueando el envío si no está marcada. | Cliente | Must |
| RF-3.3 | El sistema debe presentar la interfaz en el idioma detectado del navegador, con opción manual de cambio de idioma. | Cliente | Should |
| RF-3.4 | El sistema debe permitir al cliente consultar su historial de citas pasadas y futuras desde un panel de autogestión. | Cliente | Should |
| RF-3.5 | El sistema debe permitir al cliente cancelar o reprogramar una cita propia hasta un límite de tiempo configurado por el negocio. | Cliente | Must |
| RF-3.6 | El sistema debe generar, por tenant, una URL pública indexable por motores de búsqueda (renderizada en servidor, con metadatos de título, descripción e imagen), embebible además como botón de reserva en redes sociales. | Dueño / Cliente | Must |

### 3.4 Notificaciones y WhatsApp

| ID | Requisito | Actor | Prioridad |
| --- | --- | --- | --- |
| RF-4.1 | El sistema debe enviar confirmación y recordatorio de cita vía WhatsApp Business API como canal prioritario. | Sistema | Must |
| RF-4.2 | El sistema debe enviar la notificación por Email o SMS si el envío por WhatsApp falla o si el tenant lo tiene configurado como canal preferido. | Sistema | Must |
| RF-4.3 | El sistema debe recibir y procesar los mensajes entrantes mediante el webhook de la WhatsApp Business Cloud API de Meta, verificando la firma criptográfica de cada evento antes de procesarlo y descartando los eventos duplicados por su identificador de mensaje (whatsapp\_message\_id), de modo que un mismo mensaje reenviado no genere más de un registro de conversación ni más de una reserva. | Sistema | Must |
| RF-4.4 | El sistema debe resolver el tenant destinatario de cada conversación a partir del identificador del número de WhatsApp del negocio al que escribe el cliente (phone\_number\_id de Meta, almacenado como whatsapp\_phone\_number\_id en la configuración del tenant y como meta\_phone\_number\_id en la conversación), y debe rechazar y descartar todo mensaje dirigido a un número que no esté asociado a un tenant activo. | Sistema | Must |
| RF-4.5 | El sistema debe guiar al cliente por un flujo conversacional que le permita consultar la disponibilidad, seleccionar servicio, profesional y horario, y crear una reserva en estado pendiente de pago con origen "whatsapp", registrando en la conversación el estado alcanzado en cada paso del flujo. | Cliente / Sistema | Must |
| RF-4.6 | El sistema debe enviar por WhatsApp el enlace de pago del anticipo correspondiente a la reserva creada en el chat y, si el cliente abandona el flujo o la sesión conversacional expira, debe redirigirlo al portal web del tenant marcando la conversación con el estado "redirected\_to\_web". | Sistema / Cliente | Must |
| RF-4.7 | El sistema debe utilizar exclusivamente plantillas de mensaje previamente aprobadas por Meta para todo mensaje iniciado por el negocio fuera de la ventana de servicio de 24 horas, y debe registrar el intento como fallido y activar el canal de respaldo cuando la plantilla no esté aprobada o sea rechazada | Sistema | Must |

### 3.5 Pagos, comisiones y cancelaciones

| ID | Requisito | Actor | Prioridad |
| --- | --- | --- | --- |
| RF-5.1 | El sistema debe integrar una pasarela de pagos activa (Wompi en ambiente de pruebas durante la Fase 1\) que procese el cobro del anticipo del cliente y permita retener automáticamente la comisión de la plataforma en cada reserva confirmada, expuesta mediante una interfaz abstracta (plug-and-play) que permita conectar otras pasarelas en fases futuras sin modificar el núcleo del sistema. | Sistema / Equipo de desarrollo | Must |
| RF-5.2 | El sistema debe exigir y procesar el pago de un anticipo a través de la pasarela integrada como condición para confirmar una reserva. | Cliente / Sistema | Must |
| RF-5.3 | El sistema debe calcular y retener automáticamente la comisión de la plataforma sobre cada anticipo aprobado, usando el porcentaje congelado en la cita al momento de crearla, y acreditar el saldo restante al negocio mediante un asiento en el libro contable interno (ledger). | Sistema | Must |
| RF-5.4 | El sistema debe liberar automáticamente el horario reservado si el pago del anticipo no es aprobado por la pasarela dentro del tiempo límite configurado (15 minutos). | Sistema | Must |
| RF-5.5 | El sistema debe procesar la devolución o retención del anticipo según la regla de cancelación aplicable: cancelación del cliente dentro de plazo, cancelación por parte del negocio, o cancelación fuera de plazo / inasistencia. | Sistema / Cliente / Dueño | Must |

## 4. Requisitos no funcionales

| ID | Categoría | Criterio verificable |
| --- | --- | --- |
| RNF-01 | Escalabilidad | El sistema debe permitir crear tenants de distintos tipos de negocio (barbería, consultorio, cancha) sobre las mismas colecciones y el mismo esquema de documentos, sin cambios de código ni scripts de migración adicionales. |
| RNF-02 | Rendimiento | El sistema debe rechazar el 100% de los intentos de reserva que se solapen para el mismo recurso y franja horaria, con un tiempo de respuesta ≤2 segundos ante ≥2 solicitudes simultáneas. |
| RNF-03 | Seguridad | El sistema debe rechazar (HTTP 400/401) el 100% de las solicitudes a la API que no incluyan un tenant\_id válido en el token. |
| RNF-04 | Mantenibilidad | El 100% de los textos de interfaz y notificaciones debe provenir de archivos de traducción, sin cadenas de texto embebidas en el código, verificable mediante auditoría de código. |
| RNF-05 | Mantenibilidad | El sistema debe permitir activar un idioma o moneda adicional para un tenant en menos de 1 día-persona, sin requerir un nuevo release del backend. |
| RNF-06 | Seguridad | El sistema debe responder con error 403 cuando un usuario con rol "profesional" intente acceder a endpoints exclusivos del rol "dueño". |
| RNF-07 | Escalabilidad | El sistema debe dejar operativo un nuevo tenant en menos de 24 horas desde el envío del formulario de alta, sin necesidad de despliegue de código. |
| RNF-08 | Rendimiento | Un servicio eliminado del catálogo debe dejar de estar disponible para nuevas reservas en menos de 1 minuto. |
| RNF-09 | Seguridad | Al revocar el acceso de un profesional, el sistema debe rechazar su siguiente intento de inicio de sesión en menos de 1 minuto. |
| RNF-10 | Rendimiento | El recordatorio automático de cita debe dispararse dentro de una ventana de ±5 minutos respecto a la hora configurada por el dueño. |
| RNF-11 | Rendimiento | La disponibilidad mostrada al cliente debe reflejar cambios (bloqueos o nuevas reservas) en menos de 5 segundos, sin recargar la página. |
| RNF-12 | Usabilidad | Un cliente sin cuenta previa debe poder completar una reserva válida en un máximo de 3 pasos/pantallas. |
| RNF-13 | Seguridad | El sistema debe rechazar el 100% de los envíos de formularios con datos del cliente que no tengan marcada la casilla de aceptación de Habeas Data, registrando cada consentimiento con timestamp auditable. |
| RNF-14 | Usabilidad | La interfaz debe mostrarse correctamente en español y en inglés según el header Accept-Language del navegador del cliente. |
| RNF-15 | Usabilidad | La URL pública del tenant debe ser indexable por motores de búsqueda y renderizar contenido correctamente sin JavaScript habilitado, verificable con una herramienta de validación de metadatos. |
| RNF-16 | Disponibilidad | El 95 % de los mensajes de confirmación/recordatorio por WhatsApp Business Cloud API deben entregarse correctamente en menos de 1 minuto tras el evento, en entorno de pruebas. |
| RNF-17 | Disponibilidad | Ante una falla del proveedor de WhatsApp, el sistema debe reintentar el envío por el canal de respaldo (Email/SMS) en menos de 2 minutos. |
| RNF-18 | Mantenibilidad | La interfaz de pagos abstracta debe permitir agregar un proveedor de pago simulado ("mock") sin modificar el código del motor de reservas ni el esquema de documentos del modelo de datos. |
| RNF-19 | Seguridad / Fiabilidad | El sistema debe registrar el 100% de las transacciones de pago (aprobadas, rechazadas o reembolsadas) con un identificador único trazable, verificable mediante auditoría del registro de transacciones. |
| RNF-20 | Rendimiento | El sistema debe confirmar o rechazar el estado de un pago de anticipo en un máximo de 10 segundos tras la respuesta de la pasarela, medido en entorno de pruebas (sandbox). |
| RNF-21 | Rendimiento | El sistema debe liberar automáticamente la franja horaria reservada cuando el pago no se complete dentro de los 15 minutos establecidos. |
| RNF-22 | Seguridad | El sistema debe garantizar el aislamiento de datos entre tenants, de modo que un negocio solo pueda acceder a la información que le corresponde. |
| RNF-23 | Fiabilidad | El sistema debe registrar en audit\_logs todas las escrituras realizadas sobre las colecciones críticas definidas para auditoría, evitando registros duplicados. |
| RNF-24 | Fiabilidad | El sistema debe implementar control de concurrencia optimista para evitar la pérdida de datos cuando se realicen modificaciones simultáneas sobre un mismo documento. |
| RNF-25 | Fiabilidad | El sistema debe garantizar que un mismo evento de webhook no genere registros o movimientos duplicados en el sistema. |
| RNF-26 | Mantenibilidad | El sistema debe archivar en Cloudflare R2 y eliminar de la base operativa los registros de notifications y audit\_logs con más de 90 días de antigüedad. |
| RNF-27 | Rendimiento | El webhook de WhatsApp debe responder en un máximo de 5 segundos y procesar los mensajes de forma asíncrona. |

## 5. Reglas de negocio

### 5.1 Núcleo

| ID | Regla de negocio | Actor |
| --- | --- | --- |
| RN-1.1 | Un mismo recurso (profesional, cancha, consultorio, etc) no puede tener dos reservas activas en la misma franja horaria, toda superposición de turnos está prohibida | Profesional |
| RN-1.2 | Los datos, configuración y citas de un negocio son exclusivos de ese negocio, ningún otro negocio puede acceder a ellos o modificarlos | Dueño, Plataforma |
| RN-1.3 | Sólo el dueño de un negocio puede consultar la información financiera y los reportes de ese negocio | Dueño, Profesional |
| RN-1.4 | Un profesional solo puede gestionar su propia agenda y las citas que le fueron asignadas, no puede modificar la agenda de otro profesional | Profesional |
| RN-1.5 | Una cita solo puede considerarse válida si dueño, profesional y cliente están de acuerdo en el mismo instante real, sin importar el huso horario de cada uno | Cliente, Profesional |
| RN-1.6 | Todo negocio debe ser identificable de forma inequívoca a través de un único número de WhatsApp Business o de un paso explícito de selección; un cliente no puede quedar en ambigüedad sobre con qué negocio está agendando. | Dueño, Plataforma |

### 5.2 Gestión administrativa

| ID | Regla de negocio | Actor |
| --- | --- | --- |
| RN-2.1 | Un servicio retirado del catálogo no invalida los compromisos ya adquiridos con los clientes que lo reservaron bajo las condiciones (precio, duración) vigentes al momento de la reserva | Cliente, Dueño |
| RN-2.2 | Un profesional solo puede atender citas de los servicios que el negocio le haya habilitado explícitamente | Profesional, Cliente |
| RN-2.3 | Ninguna cita puede agendarse en una fecha u horario bloqueado por el negocio o por el profesional | Profesional, Cliente |
| RN-2.4 | Al revocarse el acceso de un profesional, sus citas futuras ya asignadas deben reasignarse a otro profesional o cancelarse notificando al cliente. Ninguna cita puede quedar sin responsable | Profesional, Dueño, Cliente |
| RN-2.5 | Toda cita cuya fecha y hora ya pasaron debe quedar en un estado definitivo (Asistió, No Asistió o Cancelada) | Profesional, Dueño, Cliente |

### 5.3 Portal del cliente y reservas

| ID | Regla de negocio | Actor |
| --- | --- | --- |
| RN-3.1 | Toda reserva debe contar como mínimo con nombre del cliente, un medio de contacto (Teléfono o correo) y el servicio solicitado, sin estos datos la reserva no es válida | Cliente |
| RN-3.2 | Ningún dato personal del cliente puede almacenarse ni tratarse sin su consentimiento explícito (Habeas Data) | Cliente, Plataforma |
| RN-3.3 | Toda cancelación o reprogramación solicitada después del plazo límite definido por el negocio queda sujeta a las condiciones que el negocio determine (Pérdida de cupo o cargo por inasistencia) | Cliente, Dueño |
| RN-3.4 | Una cita ya finalizada no puede editarse ni reprogramarse, sólo consultarse en el historial | Cliente |

### 5.4 Notificaciones y WhatsApp

| ID | Regla de negocio | Actor |
| --- | --- | --- |
| RN-4.1 | Una cita solo se considera confirmada cuando el cliente ha recibido la confirmación de su reserva. | Cliente, Sistema |
| RN-4.2 | Las reservas realizadas por WhatsApp deben cumplir las mismas reglas de disponibilidad, pago, cancelación y tratamiento de datos personales que las reservas realizadas por el portal web. | Cliente, Sistema |
| RN-4.3 | Un mensaje de WhatsApp recibido no puede generar más de un registro de conversación ni más de una reserva. | Cliente, Sistema |
| RN-4.4 | Cada conversación de WhatsApp debe estar asociada a un único negocio identificado por su número de WhatsApp Business. | Cliente, Sistema |
| RN-4.5 | Los mensajes iniciados por el negocio fuera de la ventana de atención de WhatsApp deben utilizar una plantilla aprobada por Meta. | Dueño, Sistema |

### 5.5 Pagos, comisiones y cancelaciones

| ID | Regla de negocio | Actor |
| --- | --- | --- |
| RN-5.1 | Toda cita pagada genera una comisión para ReservaYa según el plan vigente del negocio: 5 % en el plan básico y 3 % en el plan pro. La comisión aplicable se congela al crear la cita. | Dueño, Plataforma |
| RN-5.2 | Los servicios deben mostrarse y cobrarse únicamente en la moneda configurada por el negocio. | Dueño, Cliente |
| RN-5.3 | Toda cita requiere el pago de un anticipo para ser confirmada. El anticipo corresponde al 30 % del servicio y puede configurarse entre 10 % y 100 %. | Cliente, Sistema |
| RN-5.4 | La comisión de ReservaYa se descuenta del anticipo antes de acreditar el saldo correspondiente al negocio. | Dueño, Plataforma |
| RN-5.5 | Si el cliente cancela dentro del plazo permitido, se devuelve el anticipo descontando el costo de procesamiento de la pasarela. | Cliente |
| RN-5.6 | Si el negocio cancela una cita, se devuelve al cliente el 100 % del anticipo y el negocio asume el costo de procesamiento no reembolsable. | Dueño, Cliente |
| RN-5.7 | Si el cliente cancela fuera del plazo permitido o no asiste a la cita, el anticipo no es reembolsable. | Cliente |
| RN-5.8 | El saldo a favor del negocio se registra en el ledger y su liquidación bancaria automatizada queda fuera del alcance de la Fase 1\. | Dueño, Plataforma |
| RN-5.9 | La transferencia bancaria automatizada requiere una cuenta o método de cobro registrado y verificado. Esta funcionalidad corresponde a la Fase 2\. | Dueño, Plataforma |
| RN-5.10 | En Fase 2, un saldo negativo podrá descontarse de futuras liquidaciones y generar el bloqueo de nuevas reservas si permanece sin regularizar durante más de dos semanas. | Dueño, Plataforma |

## 6. Historias de usuario

| ID | Historia de usuario | Requisitos relacionados |
| --- | --- | --- |
| HU-01 | Como dueño de un negocio, quiero registrar mi negocio mediante un formulario asistido, para comenzar a operar en la plataforma con la configuración básica necesaria. | RF-1.8 |
| HU-02 | Como dueño o administrador de plataforma, quiero activar o desactivar idiomas y monedas para un negocio, para adaptar la plataforma a sus necesidades sin modificar el código. | RF-1.6 |
| HU-03 | Como usuario del sistema, quiero iniciar sesión y acceder únicamente a las funciones correspondientes a mi rol, para proteger la información y las acciones disponibles. | RF-1.7 |
| HU-04 | Como usuario, quiero que mi identidad, rol y negocio sean gestionados mediante un proveedor de identidad externo, para acceder de forma segura sin que la plataforma almacene mi contraseña. | RF-1.9 |
| HU-05 | Como administrador de plataforma o dueño, quiero consultar los registros de auditoría de mi ámbito de acceso, para poder revisar los cambios realizados sobre información crítica. | RF-1.10 |
| HU-06 | Como administrador de plataforma, quiero gestionar negocios de diferentes tipos mediante un modelo genérico de recurso, servicio y turno, para administrar distintos verticales sin desarrollar una lógica específica para cada uno. | RF-1.1 |
| HU-07 | Como dueño, quiero configurar la zona horaria y la moneda de mi negocio, para que las citas y los precios se muestren correctamente a mis clientes. | RF-2.1 |
| HU-08 | Como dueño, quiero crear, editar y eliminar servicios indicando su nombre, duración y precio, para mantener actualizado el catálogo de mi negocio. | RF-2.2 |
| HU-09 | Como dueño, quiero registrar profesionales y asignarles horarios y servicios, para organizarla atención de los clientes. | RF-2.3 |
| HU-10 | Como dueño o profesional, quiero bloquear fechas u horarios específicos, para evitar que los clientes reserven cuando no existe disponibilidad. | RF-2.4 |
| HU-11 | Como dueño, quiero consultar indicadores de ocupación, servicios más solicitados, desempeño de profesionales e inasistencias, para conocer el comportamiento de mi negocio. | RF-2.5 |
| HU-12 | Como profesional o dueño, quiero registrar el estado final de una cita, para mantener actualizado el historial de atención. | RF-2.6 |
| HU-13 | Como dueño, quiero dar de alta o revocar el acceso de un profesional, para controlar quién puede operar dentro de mi negocio. | RF-2.7 |
| HU-14 | Como dueño, quiero configurar con cuánta anticipación se envía el recordatorio de cita, para adaptar las notificaciones a las necesidades de mi negocio. | RF-2.8 |
| HU-15 | Como dueño, quiero consultar mi saldo acumulado, las comisiones retenidas y los movimientos del periodo, para conocer el estado financiero de mi negocio dentro de la plataforma. | RF-2.9 |
| HU-16 | Como cliente, quiero consultar en tiempo real los horarios disponibles de un servicio y profesional, mostrados en mi zona horaria, para elegir cuándo reservar. | RF-3.1 |
| HU-17 | Como cliente, quiero reservar un servicio proporcionando mis datos básicos, con o sin una cuenta registrada, para agendar de forma sencilla. | RF-3.2 |
| HU-18 | Como cliente, quiero aceptar el tratamiento de mis datos personales antes de enviar un formulario, para autorizar su uso de manera explícita. | RF-3.2b |
| HU-19 | Como cliente, quiero utilizar la plataforma en el idioma de mi navegador o seleccionar otro manualmente, para interactuar con ella en el idioma que prefiera. | RF-3.3 |
| HU-20 | Como cliente, quiero consultar mis citas pasadas y futuras, para llevar el control de mis reservas. | RF-3.4 |
| HU-21 | Como cliente, quiero cancelar o reprogramar una cita dentro del plazo establecido por el negocio, para modificar mis reservas cuando sea necesario. | RF-3.5 |
| HU-22 | Como dueño, quiero disponer de una página pública de reservas para mi negocio, para que los clientes puedan encontrarlo y reservar desde internet. | RF-3.6 |
| HU-23 | Como cliente, quiero recibir la confirmación y el recordatorio de mi cita por WhatsApp, para mantenerme informado sobre mi reserva. | RF-4.1 |
| HU-24 | Como cliente, quiero recibir la notificación por correo electrónico o SMS cuando WhatsApp no esté disponible o el negocio lo prefiera, para asegurar la recepción de mis avisos. | RF-4.2 |
| HU-25 | Como cliente, quiero enviar mensajes al WhatsApp del negocio para consultar y gestionar una reserva, para agendar sin tener que ingresar al portal web. | RF-4.3, RF-4.4, RF-4.5 |
| HU-26 | Como cliente, quiero seleccionar por WhatsApp el servicio, profesional y horario disponibles, para completar mi reserva desde el chat. | RF-4.5 |
| HU-27 | Como cliente, quiero recibir por WhatsApp el enlace para pagar el anticipo de mi reserva, para completar el proceso desde la conversación. | RF-4.6 |
| HU-28 | Como cliente, quiero ser dirigido al portal web cuando no pueda completar el proceso por WhatsApp, para poder finalizar mi reserva por otro canal. | RF-4.6 |
| HU-29 | Como administrador de plataforma, quiero que los mensajes de WhatsApp sean procesados únicamente cuando provengan de eventos válidos y no duplicados, para evitar conversaciones o reservas repetidas. | RF-4.3 |
| HU-30 | Como sistema, quiero identificar el negocio asociado al número de WhatsApp al que escribe el cliente, para dirigir cada conversación al tenant correspondiente. | RF-4.4 |
| HU-31 | Como dueño, quiero que los mensajes iniciados por mi negocio fuera de la ventana de atención utilicen plantillas aprobadas por Meta, para asegurar el cumplimiento de las reglas de WhatsApp. | RF-4.7 |
| HU-32 | Como cliente, quiero pagar el anticipo de mi reserva mediante la pasarela de pagos disponible, para confirmar mi cita. | RF-5.1, RF-5.2 |
| HU-33 | Como dueño, quiero que la plataforma calcule y retenga automáticamente su comisión sobre cada anticipo aprobado, para no tener que realizar este cálculo manualmente. | RF-5.3 |
| HU-34 | Como cliente, quiero que el horario reservado se libere automáticamente si no realizo el pago dentro del tiempo establecido, para que la franja pueda volver a estar disponible. | RF-5.4 |
| HU-35 | Como cliente, quiero que mi anticipo sea devuelto o retenido según la política de cancelación aplicable, para conocer cómo se gestiona mi pago cuando una cita se cancela. | RF-5.5 |
| HU-36 | Como dueño, quiero que las reservas no puedan solaparse para un mismo recurso y horario, para evitar que dos clientes sean agendados simultáneamente. | RF-1.2 |
| HU-37 | Como cliente, quiero ver las fechas y horas de mis reservas convertidas a mi zona horaria, para evitar confusiones sobre el momento de la cita. | RF-1.3 |
| HU-38 | Como sistema, quiero identificar en cada solicitud el tenant, idioma, moneda y región correspondientes, para procesar la información según el contexto correcto. | RF-1.4 |
| HU-39 | Como equipo de desarrollo, quiero gestionar los textos de la interfaz y las notificaciones mediante archivos de traducción, para facilitar el mantenimiento y la incorporación de nuevos idiomas. | RF-1.5 |

## 7. Evidencia y aceptación de la versión

La corrida de integración continua del backend del 18 de noviembre de 2026, sobre el commit `870ad2438c3f`, registró 218 pruebas aprobadas en 32 archivos. La ronda pública del 20 de noviembre comprobó el acceso al portal de Café Demo. El catálogo de ese negocio no tenía servicios ni profesionales y la reserva quedó bloqueada en el primer paso. [Corrida de CI](https://github.com/DavidGV-ux/Back-Reserva-Ya/actions/runs/44246667139) · [Ronda pública](../Pruebas/ronda-01-portal.md)

| Área y requisitos | Evidencia disponible | Evidencia requerida para la aceptación |
| --- | --- | --- |
| Anticipo y confirmación · RF-5.1–RF-5.3, RNF-19, RNF-20 | La suite del backend cubre escenarios controlados con Wompi y PayU y la actualización de la cita y del libro contable. | Identificar el proveedor y su modo en el entorno de entrega. Registrar la transacción de prueba, su estado, el tiempo de respuesta y el efecto contable. |
| Vencimiento · RF-5.4, RNF-21 | La línea base fija 15 minutos. La interfaz pública anunciaba 30 minutos. La suite verifica la liberación de la franja al superar el plazo configurado. El escenario EC04 establece un máximo de cinco minutos entre el vencimiento y la liberación. | Medir por separado el plazo de pago y el tiempo que tarda en liberarse la franja. Registrar la configuración efectiva y, si corresponde un cambio de requisito, formalizarlo en un acta. |
| Reembolso · RF-5.5, RN-5.5 | RN-5.5 establece el descuento del costo de procesamiento si el cliente cancela a tiempo. El criterio CA10 del documento de calidad espera la devolución del 100 % del anticipo. | Confirmar la regla aplicable y verificarla con una cancelación de cliente en sandbox. Registrar el importe, el resultado del proveedor y la decisión en el acta correspondiente. |
| Recepción de avisos · RF-4.1–RF-4.2, RN-4.1, RNF-10, RNF-16–RNF-17 | La suite cubre la emisión de avisos, los recordatorios programados y el respaldo por correo. RN-4.1 establece la recepción de la confirmación como condición de negocio. | Registrar por separado el estado de la cita, el envío y la recepción efectiva, con el canal, la fecha y la hora. Medir los umbrales de entrega y respaldo en el entorno previsto. |
| Reserva por WhatsApp · RF-4.3–RF-4.7, RNF-27 | El backend cuenta con una prueba de integración del recorrido. El ADR-14 identifica `ReservaYa-Whatsapp` como servicio oficial del canal. | Identificar el servicio desplegado y verificar desde el canal de prueba la reserva, el enlace de anticipo y la continuidad en el portal cuando corresponda. Comprobar el tiempo de respuesta y el procesamiento asíncrono. |
| Reserva web · RF-3.1–RF-3.2b, RNF-12–RNF-14 | Café Demo mostró cuatro etapas visibles: servicio, horario, datos y pago. La línea base establece un máximo de tres pasos o pantallas para el recorrido de invitado. La revisión observó claves de traducción visibles en inglés. | Ejecutar una reserva completa con un catálogo disponible, comprobar el consentimiento y ambos idiomas, y registrar qué pantallas se cuentan al medir RNF-12. |
| Archivado de registros · RNF-26 | La integración continua aporta pruebas de creación, retención y restauración de copias de base de datos. | Aportar evidencia del archivo en R2 y la purga de los registros de notificaciones y auditoría con más de 90 días en el entorno evaluado. |

La aceptación se documenta en el [acta de cierre](../Cierre/). Para cada requisito se consulta su fila en la [matriz de trazabilidad](../Trazabilidad/matriz-trazabilidad.csv) y el resultado correspondiente en el [registro de pruebas](../Pruebas/resultados.csv). La evidencia de validación identifica ambiente y versión, y las decisiones que modifican la línea base se registran en las [actas de modificación](../Actas/).

## 8. Control de versiones y fuentes

| Versión | Fecha | Cambio |
| --- | --- | --- |
| 1.1 | 7 de septiembre de 2026 | Línea base de requisitos, reglas de negocio e historias de usuario de ReservaYa. |
| 2.0 | 20 de noviembre de 2026 | Consolidación para la entrega de Fase 1. Conserva 38 requisitos funcionales, 27 no funcionales, 30 reglas de negocio y 39 historias de usuario. Incorpora el contexto de entrega y la evidencia de revisión. |

Fuentes de la consolidación:

- Documento de Especificación de Requisitos de Software de ReservaYa, v1.1, del 7 de septiembre de 2026.
- Documento de escenarios de calidad y criterios de aceptación de ReservaYa, incluidos EC04, CA09 y CA10.
- [Evidencia de integración continua](../Pruebas/evidencia-ci.md) y [ronda pública del entorno de demostración](../Pruebas/ronda-01-portal.md).
- [Repositorio del backend](https://github.com/DavidGV-ux/Back-Reserva-Ya/tree/870ad2438c3f3452879da0d36ba19ad0495d97ca) y [repositorio del canal conversacional](https://github.com/DavidGV-ux/ReservaYa-Whatsapp/tree/bf36f06c6c4047e6c8aa7aea88916cbcfcda5113).
