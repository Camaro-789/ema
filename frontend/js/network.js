// Definición de elementos de red de fibra óptica
const NetworkTypes = {
    OLT: {
        id: 'olt',
        name: 'Nodo OLT',
        type: 'Point',
        color: '#e74c3c', // Rojo
        icon: '🔴',
        radius: 8,
        properties: { name: '', capacity: '10G', status: 'ACTIVE' }
    },
    SPLITTER: {
        id: 'splitter',
        name: 'Splitter',
        type: 'Point',
        color: '#e67e22', // Naranja
        icon: '🟠',
        radius: 6,
        properties: { name: '', ratio: '1:8', status: 'ACTIVE' }
    },
    NAP: {
        id: 'nap',
        name: 'Caja NAP',
        type: 'Point',
        color: '#f1c40f', // Amarillo
        icon: '🟡',
        radius: 6,
        properties: { name: '', ports: 8, used_ports: 0, status: 'ACTIVE' }
    },
    CLIENT: {
        id: 'client',
        name: 'Cliente / ONT',
        type: 'Point',
        color: '#3498db', // Azul
        icon: '🔵',
        radius: 5,
        properties: { name: '', contract: '', status: 'ACTIVE' }
    },
    CABLE: {
        id: 'cable',
        name: 'Cable Fibra',
        type: 'LineString',
        color: '#2ecc71', // Verde
        width: 3,
        properties: { name: '', cores: 12, status: 'ACTIVE' }
    }
};

const StatusColors = {
    ACTIVE: '#2ecc71',
    MAINTENANCE: '#f39c12',
    ERROR: '#e74c3c',
    PLANNED: '#95a5a6'
};
