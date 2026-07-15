# Catálogo de plantas modelo +Agua — v1.3

**Fecha:** 14/07/2026 (v1.1) · **Fuente:** conocimiento de Leonardo; v1.0 08/07 (estructuración inicial); v1.1 14/07 con 3 reglas surgidas del banco de pruebas de CriterIA (corridas Cuesta Blanca y Castelli); v1.2 14/07 con la regla del dosificador de reemplazo (corrida Tacural); v1.3 14/07 con la regla de intervenciones sobre terceros (corrida 19 de Septiembre + nota modelo ASSA)
**Propósito:** dato consumible para el caso C del Asistente IA (generación del planteo de proyecto desde el relevamiento) y documentación de la estandarización del diseño (TFI, capítulo de intervención).

---

## 0. El marco de análisis: las seis preguntas canónicas

Todo proyecto +Agua, por macro que sea, se analiza respondiendo:

| Pregunta | Variable | Instrumento típico |
|---|---|---|
| ¿Cuánto llega? | caudal y presión de ingreso | caudalímetro + transductor de presión |
| ¿Cuánto tengo? | nivel de 1 o más tanques | sensor de nivel (ultrasónico/barométrico) |
| ¿Cuánto entrego? | caudal y presión de salida | caudalímetro + transductor de presión |
| ¿Con qué calidad entrego? | dosificación de cloro | pulsos del dosificador o consumo de la bomba |
| ¿Cómo entrego? | bombeo | accesorio de monitoreo de bomba |
| ¿Cómo está la planta? | energía | analizador de red |

**La planta modelo mínima (§1) es la respuesta estándar a estas seis preguntas.**
En proyectos macro (automatización con PLC/variadores, presión de red urbana,
niveles cloacales urbanos), la planta básica reaparece siempre como núcleo,
"oculta" dentro del proyecto mayor. No hay otras plantas modelo tabuladas:
para lo no estándar, el análisis se hace granularmente guiado por las seis
preguntas (regla operativa para el Asistente IA: ante un relevamiento que
excede la planta mínima, preguntar por cada una de las seis dimensiones).

---

## 1. Planta modelo mínima ("planta de agua")

### 1.1 Variables monitoreadas

| # | Variable | Alternativas admitidas |
|---|---|---|
| 1 | Nivel de cisterna/tanque | — |
| 2 | Caudal de macromedición (1) | subida a tanque (succión de napas) · ingreso por acueducto · entrega a red domiciliaria |
| 3 | Presión (1) | de ingreso · de salida |
| 4 | Dosificación de cloro | pulsos del propio dosificador · consumo energético de la bomba de cloro |
| 5 | Nivel del tanque de cloro | — |
| 6 | Bomba trifásica (1) | presurización de red · subida a tanque |
| 7 | Energía de la planta | — |

### 1.2 Lista de materiales (BOM estándar)

| Equipo | Cant. | Notas |
|---|---|---|
| Multivac | 2 | mínimo SIEMPRE (regla de diseño §1.4); asignación en §1.3 |
| Router Mikrotik | 1 (mínimo) | vinculación por VPN |
| Analizador de red Gralf | 1 | con sus 3 transformadores de corriente |
| Transductor de presión (4-20 mA) | 1 | |
| Accesorio modbus de monitoreo de bomba | 2 | trifásica (presurizadora) + monofásica (dosificadora); mismo equipo. Alternativa para la dosificadora: conversor de pulsos→modbus (costo similar) |
| Transformadores de corriente (TI) | 7 ó 6 | **7 si la dosificación va por consumo** (3 Gralf + 3 trifásica + 1 dosificadora) · **6 si va por pulsos** (3 Gralf + 3 trifásica, + conversor de pulsos) |
| Sensor ultrasónico de nivel, amplio rango (8-10 m) | 1 | cisterna (regla de selección §2) |
| Sensor ultrasónico de nivel, rango corto (2 m) | 1 | tanque de cloro; salida 4-20 mA o modbus. **Se sugiere SIEMPRE**, incluso en depósitos de rellenado diario (aclaración v1.2, caso Tacural): el valor está en monitorear la reposición y el consumo; el cliente decide si lo excluye |
| Gabinete tipo CCTV de montaje | 1 | tablero único de monitoreo (§1.4) |
| UPS 1 kVA | 1 | |
| Cables y fuentes | — | |

**NO incluido por defecto:** caudalímetro (no se provee en primera instancia;
el modelo asume integración del existente, u opcional a pedido — §3).

### 1.3 Asignación de recursos (las reglas que la IA ejecuta)

**Recursos de cada Multivac:** 3 entradas analógicas (4-20 mA) + 2 puertos modbus.

**Multivac 1 — planta:**
- AI-1 → transductor de presión (obligatorio)
- AI-2 → ultrasónico de nivel de cisterna (obligatorio)
- AI-3 → libre / caudalímetro si su salida es 4-20 mA
- Modbus canal 1 → caudalímetro (si es modbus); **bus compartido** con el accesorio de la bomba trifásica
- Modbus canal 2 → analizador Gralf, **exclusivo** (protocolo más complejo, se mantiene separado). Única excepción: varios Gralf en el mismo canal (circuitos/secciones distintas)

**Multivac 2 — cloración:**
- Modbus → accesorio de bomba dosificadora **o** conversor de pulsos→modbus (según dosificador)
- AI o modbus → ultrasónico de nivel de tanque de cloro (2 m)

**Reglas transversales:**
- Cada sensor 4-20 mA consume 1 entrada analógica; cada dispositivo modbus ocupa lugar en un bus.
- **Máximo 10 equipos por bus modbus — regla de riesgo, no de señal:** aunque la señal no se degrade, concentrar muchos dispositivos en una Multivac genera alto impacto operativo ante su rotura (deja "ciegos" a todos sus dispositivos). Lo ideal es incorporar más Multivac y distribuir el riesgo (misma filosofía que el mínimo de 2 por diagnóstico diferencial, §1.4).
- El Gralf nunca comparte bus con dispositivos de otro tipo.

### 1.4 Principios de diseño (el porqué de la arquitectura)

- **Mínimo 2 Multivac, siempre** — regla de diagnóstico diferencial: si fallan
  ambas en simultáneo, el problema es de internet/red; si falla una sola, es esa
  placa. Además distribuye la dependencia: el cliente nunca queda "ciego total".
  (No es agotamiento de recursos: es decisión de confiabilidad y diagnosticabilidad.)
- **Un único tablero de monitoreo (gabinete + UPS)** — el cableado 4-20 mA / modbus
  cubre varios metros. Restricción: todo dentro de la misma planta; **no se admiten
  cruces de calle**, aunque la distancia en metros lo permita.
- **El conversor de pulsos→modbus es hardware propio de Cooptech**, adaptable
  indistintamente a dosificadoras o caudalímetros con salida de pulsos. Beneficio
  adicional: expande las distancias de cableado (los pulsos crudos no superan un
  par de metros).

## 2. Reglas de selección

- **Inferencia de caudal por consumo eléctrico (v1.1):** siempre que el cliente
  quiera incorporar **más de 2 caudalímetros**, ofrecer como escenario
  comparativo la inferencia de caudales: medición de parámetros eléctricos de
  cada bomba (estado y consumo) + macromedición general (1 caudalímetro por
  sistema). Reduce drásticamente el costo (~USD 500/punto vs ~USD 5.000/
  caudalímetro directo) a cambio de medición indirecta. Presentar ambos
  escenarios con sus costos para decisión del cliente.
- **Nivel en tanques elevados — dos opciones válidas (v1.1):** (a) sensor
  ultrasónico en la parte superior (más exacto, opción preferida); (b) presión
  de columna de agua en la base del tanque (válida, **menos exacta** —
  calibrable por contraste con sistemas existentes de boyas). Especificar ambas
  como opciones cuando las condiciones de montaje lo ameriten.
- **Nivel de cisterna — ultrasónico vs. barométrico:** si el **rango dinámico del
  líquido supera los 10 metros**, el ultrasónico no sirve → barométrico. Caso
  típico: tanques verticales de mucha altura y poco diámetro, donde a bajo nivel
  el sensor detecta las paredes. Aclaración: en tanques elevados sobre torre, la
  altura de la torre NO cuenta — solo el rango dinámico del líquido.
- **Dosificación de cloro:** dosificador con salida de pulsos → conversor
  pulsos→modbus (y 6 TI en total); sin pulsos → accesorio de monitoreo por
  consumo de la bomba (y 7 TI en total).
- **Dosificador de reemplazo (v1.2):** cuando el dosificador actual NO tiene
  salida de datos — y especialmente si el cliente expresa que es viejo, le da
  problemas o se rompe seguido — sugerir como OPCIONAL el reemplazo por
  **Grundfos DDC (código con "AR")**: es el ÚNICO modelo con salida a relé
  (pulsos de dosificación reportables). ATENCIÓN AL CÓDIGO: los modelos se ven
  exactamente iguales y una letra cambia la funcionalidad (experiencia real:
  se adquirió un modelo con una letra de diferencia y hubo que reemplazarlo).
  Precio de referencia (presupuestado 14/07/2026): costo USD 1.205 + IVA;
  con comisión Cooptech del 20% → **USD 1.446 + IVA al cliente** (estimativo,
  confirmar al cotizar).
- **Caudalímetro existente del cliente:** salida 4-20 mA → AI-3 de Multivac 1;
  salida modbus → bus genérico; salida de pulsos → el mismo conversor propio
  pulsos→modbus.

- **Intervenciones sobre infraestructura de terceros (v1.3):** cuando el
  monitoreo requiere instalar equipamiento o leer datos en infraestructura que
  NO es del cliente (p.ej. plantas de operadores provinciales como ASSA,
  acueductos interurbanos, predios municipales), el planteo debe: (a) marcar
  esas intervenciones como CONDICIONADAS a un acuerdo formal previo; (b) emitir
  opcionalmente una **nota de solicitud editable** dirigida al tercero
  (membrete del cliente, destinatario con área técnica, asunto, propósito con
  beneficios mutuos, firma de gerencia del cliente), según el modelo real de la
  nota Cooperativa 19 de Setiembre → ASSA (nov-2024). La nota la firma el
  CLIENTE (no Cooptech): el vínculo institucional es entre prestadores.

## 3. Opcionales a solicitud del cliente (fuera de la planta mínima)

- Caudalímetro ultrasónico sin intervención en cañería
- Detector de cloro libre
- Conductímetro
- Otros a demanda

## 4. Vínculo con el presupuestador

Los precios unitarios y descripciones comerciales de estos materiales viven en el
`MATERIALES_CATALOGO` del presupuestador +Agua (`agua.html`), con la misma lógica
de consumo de recursos (analog/modbus). Este catálogo aporta la capa que faltaba:
la **composición estándar** (qué lleva una planta) y las **reglas de decisión**.
Pendiente menor: verificar que el sensor barométrico y el router Mikrotik existan
como ítems en el `MATERIALES_CATALOGO`; si no, agregarlos.

---

*Este documento es la estandarización del diseño +Agua hecha explícita: convierte
la experiencia del líder en un activo de la unidad (evidencia del capítulo de
intervención del TFI) y es el insumo directo del system prompt del caso C.*
