<#
    verificar_todo.ps1 — Chequeo completo del proyecto (arranque + todas las pruebas).

    Uso:
        cd d:\Desktop\VS\ema
        powershell -ExecutionPolicy Bypass -File .\verificar_todo.ps1

    Qué hace:
      1. Busca un Python que tenga FastAPI (el .venv de la carpeta está vacío).
      2. Comprueba que la aplicación ARRANCA (crea las tablas que falten).
      3. Corre las 14 pruebas (8 de backend y 6 de frontend) y resume OK / fallos.
         Las de backend van dentro de una transacción que NUNCA se commitea
         (scripts/ejecutar_prueba.py), así que no dejan ningún objeto de prueba en
         la base real: ni al terminar bien ni si se caen a la mitad.

    Si todo sale en verde, el servidor arranca sano y nada está roto.
#>
$ErrorActionPreference = 'Continue'
$raiz = $PSScriptRoot
$backend = Join-Path $raiz 'backend'
$frontend = Join-Path $raiz 'frontend'
$resultados = @()

function Titulo($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# ── 1. Python con FastAPI ────────────────────────────────────────────────────
Titulo 'Buscando un Python con FastAPI'
$candidatos = @('python', (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'))
$py = $null
foreach ($c in $candidatos) {
    & $c -c "import fastapi" 2>$null
    if ($LASTEXITCODE -eq 0) { $py = $c; break }
}
if (-not $py) {
    Write-Host 'No se encontró un Python con FastAPI.' -ForegroundColor Red
    Write-Host 'Instala las dependencias:  pip install -r backend\requirements.txt' -ForegroundColor Yellow
    exit 1
}
Write-Host "Python: $py" -ForegroundColor Green

# La consola de Windows puede estar en cp1252 y romper los acentos de los
# scripts: los scripts ya se protegen solos, esto es un refuerzo extra.
$env:PYTHONIOENCODING = 'utf-8'

# ── 2. Arranque de la aplicación ─────────────────────────────────────────────
Titulo 'Arranque de la aplicación (crea las tablas que falten)'
Push-Location $backend
$salidaArranque = & $py -c "import app.main; print('ARRANQUE OK')" 2>&1 | Out-String
$codeArranque = $LASTEXITCODE
Pop-Location
if ($codeArranque -ne 0) {
    Write-Host 'La aplicación NO arranca:' -ForegroundColor Red
    Write-Host $salidaArranque
    exit 1
}
$resultados += [pscustomobject]@{ Prueba = 'Arranque de la app'; OK = $true }
Write-Host '  [OK ] La aplicación arranca correctamente' -ForegroundColor Green

# ── 3. Pruebas de backend (Python) ───────────────────────────────────────────
Titulo 'Pruebas del backend'
$pruebasPy = @(
    'prueba_capa_logica.py',
    'prueba_nodo.py',
    'prueba_frontend_hilos.py',
    'prueba_frontend_diagrama.py',
    'prueba_splitter_plantilla.py',
    'prueba_diagrama_posiciones.py',
    'prueba_frontend_capas.py',
    'prueba_cable_estructura.py'
)
foreach ($t in $pruebasPy) {
    $ruta = Join-Path $backend (Join-Path 'scripts' $t)
    if (-not (Test-Path $ruta)) { Write-Host "  [--]  $t (no existe, se omite)" -ForegroundColor DarkGray; continue }
    Push-Location $backend
    # Cada prueba se ejecuta DENTRO de una transacción que nunca se commitea
    # (scripts/ejecutar_prueba.py): los objetos que crea desaparecen al terminar,
    # aunque la prueba falle a la mitad. La base real nunca queda con residuo.
    $salida = & $py "scripts\ejecutar_prueba.py" "scripts\$t" 2>&1 | Out-String
    $code = $LASTEXITCODE
    Pop-Location
    $resumen = (($salida -split "`n") | Select-String -Pattern 'RESULTADO' | Select-Object -Last 1)
    if (-not $resumen) { $resumen = "(sin resumen) exit=$code" }
    $resumen = ($resumen -replace '\s+', ' ').Trim()
    if ($code -eq 0) {
        Write-Host "  [OK ] $t -> $resumen" -ForegroundColor Green
    } else {
        Write-Host "  [X]   $t -> $resumen" -ForegroundColor Red
        (($salida -split "`n") | Select-String -Pattern '\[FALLO\]' | Select-Object -First 6) | ForEach-Object {
            Write-Host ("        " + ($_ -replace '\s+', ' ').Trim()) -ForegroundColor DarkYellow
        }
    }
    $resultados += [pscustomobject]@{ Prueba = "backend/$t"; OK = ($code -eq 0) }
}

# ── 4. Pruebas de frontend (Node) ────────────────────────────────────────────
Titulo 'Pruebas del frontend'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '  Node.js no está instalado: se omiten las pruebas de frontend.' -ForegroundColor Yellow
} else {
    $pruebasJs = @(
        'prueba_render_hilos.js',
        'prueba_render_splitter.js',
        'prueba_lienzo_diagrama.js',
        'prueba_mover_splitter.js',
        'prueba_recorrido_fibra.js',
        'prueba_reglas_cable.js'
    )
    foreach ($t in $pruebasJs) {
        $ruta = Join-Path $frontend (Join-Path 'scripts' $t)
        if (-not (Test-Path $ruta)) { Write-Host "  [--]  $t (no existe, se omite)" -ForegroundColor DarkGray; continue }
        Push-Location $frontend
        $salida = & node "scripts\$t" 2>&1 | Out-String
        $code = $LASTEXITCODE
        Pop-Location
        $resumen = (($salida -split "`n") | Select-String -Pattern 'RESULTADO' | Select-Object -Last 1)
        if (-not $resumen) { $resumen = "(sin resumen) exit=$code" }
        $resumen = ($resumen -replace '\s+', ' ').Trim()
        if ($code -eq 0) {
            Write-Host "  [OK ] $t -> $resumen" -ForegroundColor Green
        } else {
            Write-Host "  [X]   $t -> $resumen" -ForegroundColor Red
            (($salida -split "`n") | Select-String -Pattern '\[FALLO\]' | Select-Object -First 6) | ForEach-Object {
                Write-Host ("        " + ($_ -replace '\s+', ' ').Trim()) -ForegroundColor DarkYellow
            }
        }
        $resultados += [pscustomobject]@{ Prueba = "frontend/$t"; OK = ($code -eq 0) }
    }
}

# ── 5. Resumen ───────────────────────────────────────────────────────────────
Titulo 'RESUMEN'
$ok = ($resultados | Where-Object { $_.OK }).Count
$fallos = ($resultados | Where-Object { -not $_.OK }).Count
Write-Host ("  Correctas: $ok    Con fallos: $fallos") -ForegroundColor Cyan
if ($fallos -eq 0) {
    Write-Host '  TODO EN VERDE: el sistema arranca y no hay pruebas rotas.' -ForegroundColor Green
    exit 0
} else {
    Write-Host '  Revisa arriba las pruebas marcadas con [X].' -ForegroundColor Red
    $resultados | Where-Object { -not $_.OK } | ForEach-Object { Write-Host ("   - " + $_.Prueba) -ForegroundColor Red }
    exit 1
}
