# Matriz de trazabilidad de ReservaYa

La [matriz CSV](matriz-trazabilidad.csv) reúne los 95 IDs del SRS v2 de Fase 1 y sus referencias a Fase 2. Contiene 38 requisitos funcionales, 30 reglas de negocio y 27 requisitos no funcionales con su criterio verificable. Cada fila identifica el componente orientativo, los casos candidatos, la evidencia disponible y lo que falta para la aceptación. [SRS v2](../SRS/SRS-v2.md) · [RES-61](https://linear.app/reservaya/issue/RES-61)

| Estado | Filas | Alcance |
| --- | ---: | --- |
| Evidencia de CI con alcance acotado | 22 | Una suite de Back aporta evidencia sobre el comportamiento indicado. Consulta la última columna de la matriz para ver el alcance y la validación pendiente en el entorno de entrega. |
| Bloqueado en ronda 01 | 6 | Los requisitos vinculados a P-CA01 o P-CA02 quedaron bloqueados porque el negocio de prueba carecía de oferta disponible para reservar. |
| Observación en interfaz | 2 | La revisión pública registró la cantidad de etapas visibles y claves de traducción. El recorrido completo sigue pendiente. |
| Pendiente de evidencia | 63 | Hay casos candidatos para ejecutar o ampliar. El reporte financiero de CI aporta contexto para RF-2.5 y quedan por verificar sus indicadores de analítica. |
| Fase 2 | 2 | El SRS asigna estas reglas a una fase posterior. |

Para actualizar una fila, ejecuta el caso con el criterio de esa fila y registra su resultado, ambiente, versión y enlace de evidencia. Usa el ID del caso y el enlace a la evidencia para actualizar la matriz. El CSV se abre como UTF-8 con coma como separador. [Catálogo de casos](../Pruebas/casos.md) · [Registro de resultados](../Pruebas/resultados.csv) · [Evidencia de CI](../Pruebas/evidencia-ci.md) · [Ronda pública](../Pruebas/ronda-01-portal.md)
