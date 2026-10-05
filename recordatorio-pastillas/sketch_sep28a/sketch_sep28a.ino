#include <WiFi.h>
#include <WebServer.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "time.h"
#include <sys/time.h>

// --- DECLARACIÓN DE PERIFÉRICOS ---
LiquidCrystal_I2C lcd(0x27, 16, 2);
WebServer server(80);
Preferences preferences;

// --- CONFIGURACIÓN DE PINES ---
const int PIN_BUZZER = 13;
const int PIN_IN1    = 16;
const int PIN_IN2    = 17;
const int PIN_IN3    = 18;
const int PIN_IN4    = 19;

// --- MOTOR PASO A PASO (28BYJ-48 + ULN2003) ---
const int PASOS_POR_VUELTA        = 4096;
const int CANTIDAD_COMPARTIMIENTOS = 8;
const int PASOS_POR_COMPARTIMIENTO = PASOS_POR_VUELTA / CANTIDAD_COMPARTIMIENTOS;

// --- MEMORIA NVS (PREFERENCES) ---
const char* NVS_NAMESPACE = "horario_cfg";
const char* NVS_KEY_HORA  = "hora";
const char* NVS_KEY_MIN   = "minuto";
const char* NVS_KEY_TIPO  = "tipo";

// --- VARIABLES GLOBALES DE ESTADO ---
int horaDispensar        = 17;
int minutoDispensar     = 16;
String nombreMedicamento = "Medicamento";
bool yaDisparado         = false;
int compartimientoActual = 0;
String ipLocal           = "";

unsigned long ultimoChequeo = 0;
const unsigned long INTERVALO_CHEQUEO_MS = 1000;

// Servidor NTP para sincronizar hora por internet
const char* ntpServer          = "pool.ntp.org";
const long  gmtOffset_sec      = -10800; // GMT-3 (Argentina / Brasil / Uruguay)
const int   daylightOffset_sec = 0;

// --- GESTIÓN DE MEMORIA PERMANENTE ---
void iniciarNVS() {
  preferences.begin(NVS_NAMESPACE, false);
}

void guardarHorarioEnNVS(int hora, int minuto, String tipo) {
  preferences.putInt(NVS_KEY_HORA, hora);
  preferences.putInt(NVS_KEY_MIN, minuto);
  preferences.putString(NVS_KEY_TIPO, tipo);
}

bool cargarHorarioDesdeNVS(int &horaOut, int &minutoOut, String &tipoOut) {
  if (!preferences.isKey(NVS_KEY_HORA) || !preferences.isKey(NVS_KEY_MIN)) {
    return false;
  }
  horaOut   = preferences.getInt(NVS_KEY_HORA, horaDispensar);
  minutoOut = preferences.getInt(NVS_KEY_MIN, minutoDispensar);
  tipoOut   = preferences.getString(NVS_KEY_TIPO, nombreMedicamento);
  return true;
}

// --- PANTALLA LCD 16x2 ---
void mostrarMensaje(String linea1, String linea2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(linea1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(linea2.substring(0, 16));
}

// --- GESTIÓN DE HORA Y RELOJ ---
void ajustarHoraSistema(time_t epochTime) {
  struct timeval tv;
  tv.tv_sec = epochTime;
  tv.tv_usec = 0;
  settimeofday(&tv, NULL);
  Serial.println("Hora del sistema ajustada correctamente vía Unix Epoch.");
}

bool obtenerHoraActual(struct tm &timeinfo) {
  return getLocalTime(&timeinfo);
}

void mostrarHoraActual() {
  struct tm timeinfo;
  if (obtenerHoraActual(timeinfo)) {
    char bufHora[17];
    snprintf(bufHora, sizeof(bufHora), "Hora: %02d:%02d:%02d",
             timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    lcd.setCursor(0, 0);
    lcd.print(bufHora);

    char bufAlarma[17];
    snprintf(bufAlarma, sizeof(bufAlarma), "Alarma: %02d:%02d", horaDispensar, minutoDispensar);
    lcd.setCursor(0, 1);
    lcd.print(bufAlarma);
  } else {
    lcd.setCursor(0, 0);
    lcd.print("IP: " + ipLocal.substring(0, 12));
    lcd.setCursor(0, 1);
    char bufAlarma[17];
    snprintf(bufAlarma, sizeof(bufAlarma), "Alarma: %02d:%02d", horaDispensar, minutoDispensar);
    lcd.print(bufAlarma);
  }
}

// --- HARDWARE: ACTUADORES ---
void activarBuzzer() {
  for (int i = 0; i < 4; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(200);
    digitalWrite(PIN_BUZZER, LOW);
    delay(150);
  }
}

void pasoMotor(int pasoActual) {
  switch (pasoActual % 8) {
    case 0: digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW);  digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, LOW);  break;
    case 1: digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, HIGH); digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, LOW);  break;
    case 2: digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, HIGH); digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, LOW);  break;
    case 3: digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, HIGH); digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, LOW);  break;
    case 4: digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, LOW);  digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, LOW);  break;
    case 5: digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, LOW);  digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, HIGH); break;
    case 6: digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, LOW);  digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, HIGH); break;
    case 7: digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW);  digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, HIGH); break;
  }
}

void girarUnaCelda() {
  Serial.println("Girando motor 1 posicion (512 pasos)...");
  for (int paso = 0; paso < PASOS_POR_COMPARTIMIENTO; paso++) {
    pasoMotor(paso);
    delayMicroseconds(1500);
  }
  // Apagar bobinas para ahorrar energía y evitar sobrecalentamiento
  digitalWrite(PIN_IN1, LOW);
  digitalWrite(PIN_IN2, LOW);
  digitalWrite(PIN_IN3, LOW);
  digitalWrite(PIN_IN4, LOW);

  compartimientoActual = (compartimientoActual + 1) % CANTIDAD_COMPARTIMIENTOS;
}

void dispensarPastilla() {
  mostrarMensaje("Hora de tomar:", nombreMedicamento);
  activarBuzzer();
  girarUnaCelda();
  delay(2000);
}

void revisarHorario() {
  struct tm timeinfo;
  if (!obtenerHoraActual(timeinfo)) return;

  if (timeinfo.tm_hour == horaDispensar && timeinfo.tm_min == minutoDispensar) {
    if (!yaDisparado) {
      Serial.println(">>> ¡ALARMA ALCANZADA! EJECUTANDO DISPENSER Y BUZZER <<<");
      dispensarPastilla();
      yaDisparado = true;
    }
  } else {
    yaDisparado = false;
  }
}

// --- SERVIDOR WEBSERVER Y RESPUESTAS CORS PARA REACT NATIVE ---
void enviarHeadersCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleOptions() {
  enviarHeadersCORS();
  server.send(204);
}

void handleIdentificar() {
  enviarHeadersCORS();
  String jsonResponse = "{\"dispositivo\":\"pastillero_esp32\",\"ip\":\"" + ipLocal + "\"}";
  server.send(200, "application/json", jsonResponse);
}

void handleConectar() {
  enviarHeadersCORS();
  IPAddress clientIP = server.client().remoteIP();
  mostrarMensaje("App Conectada!", clientIP.toString());
  delay(1200);
  server.send(200, "application/json", "{\"status\":\"ok\",\"mensaje\":\"Conexion exitosa con ESP32\"}");
}

void handleSetHorario() {
  enviarHeadersCORS();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"body vacio\"}");
    return;
  }

  StaticJsonDocument<400> doc;
  DeserializationError error = deserializeJson(doc, server.arg("plain"));

  if (error) {
    server.send(400, "application/json", "{\"error\":\"JSON invalido\"}");
    return;
  }

  int hora = doc["hora"];
  int minuto = doc["minuto"];
  String tipo = doc["tipo"] | "Medicamento";

  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) {
    server.send(400, "application/json", "{\"error\":\"Hora invalida\"}");
    return;
  }

  if (doc.containsKey("epoch")) {
    time_t epochActual = doc["epoch"];
    if (epochActual > 100000) {
      ajustarHoraSistema(epochActual);
    }
  }

  horaDispensar = hora;
  minutoDispensar = minuto;
  nombreMedicamento = tipo;

  struct tm timeinfo;
  if (obtenerHoraActual(timeinfo)) {
    yaDisparado = (timeinfo.tm_hour == horaDispensar && timeinfo.tm_min == minutoDispensar);
  } else {
    yaDisparado = false;
  }

  guardarHorarioEnNVS(horaDispensar, minutoDispensar, nombreMedicamento);

  char buffer[17];
  snprintf(buffer, sizeof(buffer), "Alarma: %02d:%02d", horaDispensar, minutoDispensar);
  mostrarMensaje("Guardado OK!", buffer);
  delay(1500);

  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void handleSyncTime() {
  enviarHeadersCORS();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"body vacio\"}");
    return;
  }

  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, server.arg("plain"));

  if (!error && doc.containsKey("epoch")) {
    time_t epochActual = doc["epoch"];
    if (epochActual > 100000) {
      ajustarHoraSistema(epochActual);
      server.send(200, "application/json", "{\"status\":\"ok\",\"mensaje\":\"Hora sincronizada\"}");
      return;
    }
  }
  server.send(400, "application/json", "{\"error\":\"Epoch invalido\"}");
}

void handleDispensar() {
  enviarHeadersCORS();
  dispensarPastilla();
  server.send(200, "application/json", "{\"status\":\"ok\",\"accion\":\"dispensado\"}");
}

void iniciarServidorHTTP() {
  server.on("/identificar", HTTP_OPTIONS, handleOptions);
  server.on("/identificar", HTTP_GET, handleIdentificar);

  server.on("/conectar", HTTP_OPTIONS, handleOptions);
  server.on("/conectar", HTTP_POST, handleConectar);
  server.on("/conectar", HTTP_GET, handleConectar);

  server.on("/horario", HTTP_OPTIONS, handleOptions);
  server.on("/horario", HTTP_POST, handleSetHorario);

  server.on("/synctime", HTTP_OPTIONS, handleOptions);
  server.on("/synctime", HTTP_POST, handleSyncTime);

  server.on("/dispensar", HTTP_OPTIONS, handleOptions);
  server.on("/dispensar", HTTP_POST, handleDispensar);

  server.begin();
  Serial.println("Servidor HTTP activo.");
}

// --- SETUP PRINCIPAL ---
void setup() {
  Serial.begin(115200);

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_IN1, LOW);
  digitalWrite(PIN_IN2, LOW);
  digitalWrite(PIN_IN3, LOW);
  digitalWrite(PIN_IN4, LOW);

  Wire.begin();
  lcd.init();
  lcd.backlight();
  mostrarMensaje("Iniciando...", "Pastillero ESP32");

  iniciarNVS();

  int horaGuardada, minutoGuardado;
  String tipoGuardado;
  if (cargarHorarioDesdeNVS(horaGuardada, minutoGuardado, tipoGuardado)) {
    horaDispensar     = horaGuardada;
    minutoDispensar   = minutoGuardado;
    nombreMedicamento = tipoGuardado;
  }

  // --- WIFIMANAGER ---
  WiFiManager wm;
  mostrarMensaje("Conectando WiFi...", "o AP: Pastillero");

  // Si no logra conectarse a una red conocida en 120 segundos, abre la red AP 'Pastillero'
  wm.setConfigPortalTimeout(120);

  if (!wm.autoConnect("Pastillero")) {
    Serial.println("Tiempo de portal agotado. Reiniciando...");
    mostrarMensaje("Sin Conexion", "Reiniciando...");
    delay(2000);
    ESP.restart();
  }

  // Conexión exitosa a la red doméstica
  ipLocal = WiFi.localIP().toString();
  Serial.print("Conectado con éxito a la red! IP: ");
  Serial.println(ipLocal);
  mostrarMensaje("WiFi Conectado!", ipLocal);
  delay(1500);

  // Configurar hora vía NTP
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  // --- ESPmDNS ---
  if (MDNS.begin("pastillero")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("Servicio mDNS activo en http://pastillero.local");
  } else {
    Serial.println("Error iniciando mDNS");
  }

  iniciarServidorHTTP();
}

// --- LOOP PRINCIPAL ---
void loop() {
  server.handleClient();

  unsigned long ahora = millis();
  if (ahora - ultimoChequeo >= INTERVALO_CHEQUEO_MS) {
    ultimoChequeo = ahora;

    mostrarHoraActual();
    revisarHorario();
  }
}