// Plantillas de proceso por producto. Al ganar un lead, siembran el backlog del
// proyecto. Las etapas 'por_equipo' generan N tareas (una por equipo monitoreado).
// Estructura pensada para, más adelante, pasar a tabla editable sin cambiar la lógica.
export const PLANTILLAS = [
  {
    id: 'tpl_reconecta',
    nombre: 'Reconecta — Implementación',
    producto: 'Reconecta',
    unidadLabel: 'Equipo',
    etapas: [
      { seq: 1, tipo: 'unica', prioridad: 'alta', titulo: 'Coordinación (videollamada o viaje)', desc: 'Pasar en limpio los detalles técnicos del relevamiento: ubicaciones GPS, nombres y matrículas, tipo de conectividad.' },
      { seq: 2, tipo: 'unica', prioridad: 'alta', titulo: 'Creación del cliente en la plataforma', desc: 'Crear la cuenta del cliente y su base de datos en la plataforma.' },
      { seq: 3, tipo: 'unica', prioridad: 'media', titulo: 'Creación de usuarios (admin y solicitados)', desc: 'Crear el usuario administrador de la cuenta y los demás usuarios que pida el cliente.' },
      { seq: 4, tipo: 'por_equipo', prioridad: 'media', titulo: 'Programación de Multivac', desc: 'Una Multivac por equipo monitoreado.' },
      { seq: 5, tipo: 'por_equipo', prioridad: 'media', titulo: 'Configuración de Mikrotik', desc: 'Un Mikrotik por equipo monitoreado.' },
      { seq: 6, tipo: 'por_equipo', prioridad: 'media', titulo: 'Armado de fuente multitensión', desc: 'Una fuente por equipo monitoreado.' },
      { seq: 7, tipo: 'por_equipo', prioridad: 'media', titulo: 'Armado de chapa de tablero', desc: 'Montaje y precableado de Multivac, Mikrotik y fuente. Una chapa por equipo.' },
      { seq: 8, tipo: 'por_equipo', prioridad: 'media', titulo: 'Implementación en campo', desc: 'Montaje de las chapas en el reconectador, configuración del mapa DNP3 y pruebas de conectividad y comandos.' },
    ],
  },
];

export const plantillasParaProductos = (productos = []) =>
  PLANTILLAS.filter(p => productos.includes(p.producto));

export const getPlantilla = (id) => PLANTILLAS.find(p => p.id === id) || null;
