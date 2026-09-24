/**
 * ftth-proyectos.js
 * Gestión de proyectos para FiberMap Táchira
 */

window.currentProjectId = null;

const FTTHProyectos = (() => {

    function apiUrl(path) {
        if (path.startsWith('http://') || path.startsWith('https://')) return path;
        const origin = window.location.origin;
        if (origin && origin !== 'null' && !origin.includes('file://')) {
            return origin + (path.startsWith('/') ? path : '/' + path);
        }
        return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
    }

    async function loadProjects() {
        try {
            const res = await fetch(apiUrl(`/api/v1/maps/projects?_t=${Date.now()}`), { cache: 'no-store' });
            const data = await res.json();
            renderSelector(data);
        } catch (err) {
            console.error('Error cargando proyectos', err);
        }
    }

    function renderSelector(projects) {
        const select = document.getElementById('project-selector');
        if (!select) return;
        
        select.innerHTML = '';
        if (projects.length === 0) {
            select.innerHTML = '<option value="">Sin proyectos</option>';
            promptCreateProject('No tienes proyectos. Crea uno para empezar:');
            return;
        }

        projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });

        const savedId = localStorage.getItem('fibermap-project-id');
        if (savedId && projects.find(p => p.id == savedId)) {
            select.value = savedId;
        }
        
        setProject(select.value);
    }

    function setProject(id) {
        if (!id) return;
        window.currentProjectId = id;
        localStorage.setItem('fibermap-project-id', id);
        
        // Notificar a todos los módulos
        document.dispatchEvent(new CustomEvent('project-changed', { detail: { id } }));
        if (window.FTTHCarpetas) window.FTTHCarpetas.loadCarpetas();
        if (window.FTTHMapa) window.FTTHMapa.cargarTodosElementos();
    }

    async function createProject(name) {
        try {
            const res = await fetch(apiUrl('/api/v1/maps/projects'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    center_lat: 7.766,
                    center_lon: -72.225,
                    zoom: 17
                })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || `Error ${res.status}`);
            }
            const data = await res.json();
            await loadProjects();
            setProject(data.id);
            const select = document.getElementById('project-selector');
            if (select) select.value = data.id;
        } catch (err) {
            alert('Error al crear proyecto: ' + err.message);
        }
    }

    function promptCreateProject(msg = 'Nombre del nuevo proyecto:') {
        const name = prompt(msg);
        if (name && name.trim()) {
            createProject(name.trim());
        }
    }

    function init() {
        const select = document.getElementById('project-selector');
        const btnNew = document.getElementById('btn-new-project');

        if (select) {
            select.addEventListener('change', (e) => {
                setProject(e.target.value);
            });
        }

        if (btnNew) {
            btnNew.addEventListener('click', () => promptCreateProject());
        }

        loadProjects();
    }

    return { init, getProjectId: () => window.currentProjectId };
})();

window.FTTHProyectos = FTTHProyectos;

