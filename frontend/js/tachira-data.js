const TACHIRA_BOUNDS = [
    [-72.5, 7.3], // Southwest
    [-71.3, 8.6]  // Northeast
];

const TACHIRA_CITIES = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-72.225, 7.766] },
            properties: { name: "San Cristóbal", type: "city" }
        },
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-72.350, 7.716] },
            properties: { name: "Rubio", type: "city" }
        },
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-72.216, 7.816] },
            properties: { name: "Táriba", type: "city" }
        },
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-72.483, 7.833] },
            properties: { name: "San Antonio", type: "city" }
        }
    ]
};
