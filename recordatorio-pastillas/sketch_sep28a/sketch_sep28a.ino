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

// --- ESTRUCTURA DE ALARMA ---
struct Alarma {
  int id;
  int hora;
  int minuto;
  String tipo;
  bool disparadoHoy;
};

#define MAX_ALARMAS 10
Alarma listaAlarmas[MAX_ALARMAS];
int totalAlarmas = 0;

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

int compartimientoActual = 0;
String ipLocal           = "";
unsigned long ultimoChequeo = 0;
const unsigned long INTERVALO_CHEQUEO_MS = 1000;

// NTP
const char* ntpServer          = "pool.ntp.org";
const long  gmtOffset_sec      = -10800; // GMT-3
const int   daylightOffset_sec = 0;

// --- GESTIÓN DE MEMORIA PERMANENTE (NVS JSON) ---
void guardarAlarmasEnNVS() {
  preferences.begin("pastillero_cfg", false);
  DynamicJsonDocument doc(2048);
  JsonArray array = doc.to<JsonArray>();

  for (int i = 0; i < totalAlarmas; i++) {
    JsonObject obj = array.createNestedObject();
    obj["id"]     = listaAlarmas[i].id;
    obj["hora"]   = listaAlarmas[i].hora;
    obj["minuto"] = listaAlarmas[i].minuto;
    obj["tipo"]   = listaAlarmas[i].tipo;
  }

  String jsonString;
  serializeJson(doc, jsonString);
  preferences.putString("alarmas_json", jsonString);
  preferences.end();
}

void cargarAlarmasDesdeNVS() {
  preferences.begin("pastillero_cfg", true);
  String jsonString = preferences.getString("alarmas_json", "");
  preferences.end();

  if (jsonString.length() == 0) return;

  DynamicJsonDocument doc(2048);
  DeserializationError error = deserializeJson(doc, jsonString);
  if (!error) {
    JsonArray array = doc.as<JsonArray>();
    totalAlarmas = 0;
    for (JsonObject obj : array) {
      if (totalAlarmas < MAX_ALARMAS) {
        listaAlarmas[totalAlarmas].id           = obj["id"];
        listaAlarmas[totalAlarmas].hora         = obj["hora"];
        listaAlarmas[totalAlarmas].minuto       = obj["minuto"];
        listaAlarmas[totalAlarmas].tipo         = obj["tipo"].as<String>();
        listaAlarmas[totalAlarmas].disparadoHoy = false;
        totalAlarmas++;
      }
    }
  }
}

// --- PANTALLA LCD ---
void mostrarMensaje(String linea1, String linea2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(linea1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(linea2.substring(0, 16));
}

void ajustarHoraSistema(time_t epochTime) {
  struct timeval tv;
  tv.tv_sec = epochTime;
  tv.tv_usec = 0;
  settimeofday(&tv, NULL);
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
    snprintf(bufAlarma, sizeof(bufAlarma), "Alarmas: %d act.", totalAlarmas);
    lcd.setCursor(0, 1);
    lcd.print(bufAlarma);
  } else {
    lcd.setCursor(0, 0);
    lcd.print("IP:" + ipLocal.substring(0, 13));
    lcd.setCursor(0, 1);
    lcd.print("Alarmas: " + String(totalAlarmas));
  }
}

// --- ACTUADORES ---
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
  for (int paso = 0; paso < PASOS_POR_COMPARTIMIENTO; paso++) {
    pasoMotor(paso);
    delayMicroseconds(1500);
  }
  digitalWrite(PIN_IN1, LOW);
  digitalWrite(PIN_IN2, LOW);
  digitalWrite(PIN_IN3, LOW);
  digitalWrite(PIN_IN4, LOW);
  compartimientoActual = (compartimientoActual + 1) % CANTIDAD_COMPARTIMIENTOS;
}

void dispensarPastilla(String medicamento) {
  mostrarMensaje("Hora de tomar:", medicamento);
  activarBuzzer();
  girarUnaCelda();
  delay(2000);
}

void revisarHorarios() {
  struct tm timeinfo;
  if (!obtenerHoraActual(timeinfo)) return;

  for (int i = 0; i < totalAlarmas; i++) {
    if (timeinfo.tm_hour == listaAlarmas[i].hora && timeinfo.tm_min == listaAlarmas[i].minuto) {
      if (!listaAlarmas[i].disparadoHoy) {
        dispensarPastilla(listaAlarmas[i].tipo);
        listaAlarmas[i].disparadoHoy = true;
      }
    } else {
      listaAlarmas[i].disparadoHoy = false;
    }
  }
}

// --- ENDPOINTS HTTP / CORS ---
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
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void handleSetHorario() {
  enviarHeadersCORS();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"body vacio\"}");
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, server.arg("plain"));

  if (error) {
    server.send(400, "application/json", "{\"error\":\"JSON invalido\"}");
    return;
  }

  int hora = doc["hora"];
  int minuto = doc["minuto"];
  String tipo = doc["tipo"] | "Medicamento";

  if (doc.containsKey("epoch")) {
    time_t epochActual = doc["epoch"];
    if (epochActual > 100000) ajustarHoraSistema(epochActual);
  }

  if (totalAlarmas < MAX_ALARMAS) {
    listaAlarmas[totalAlarmas].id = millis();
    listaAlarmas[totalAlarmas].hora = hora;
    listaAlarmas[totalAlarmas].minuto = minuto;
    listaAlarmas[totalAlarmas].tipo = tipo;
    listaAlarmas[totalAlarmas].disparadoHoy = false;
    totalAlarmas++;

    guardarAlarmasEnNVS();

    char buffer[17];
    snprintf(buffer, sizeof(buffer), "%02d:%02d (%d total)", hora, minuto, totalAlarmas);
    mostrarMensaje("Alarma Agregada", buffer);
    delay(1500);

    server.send(200, "application/json", "{\"status\":\"ok\",\"total\":" + String(totalAlarmas) + "}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Limite de alarmas alcanzado\"}");
  }
}

void handleDispensar() {
  enviarHeadersCORS();
  dispensarPastilla("Manual");
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void iniciarServidorHTTP() {
  server.on("/identificar", HTTP_OPTIONS, handleOptions);
  server.on("/identificar", HTTP_GET, handleIdentificar);

  server.on("/conectar", HTTP_OPTIONS, handleOptions);
  server.on("/conectar", HTTP_POST, handleConectar);

  server.on("/horario", HTTP_OPTIONS, handleOptions);
  server.on("/horario", HTTP_POST, handleSetHorario);

  server.on("/dispensar", HTTP_OPTIONS, handleOptions);
  server.on("/dispensar", HTTP_POST, handleDispensar);

  server.begin();
}

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

  cargarAlarmasDesdeNVS();

  WiFiManager wm;
  wm.setConfigPortalTimeout(120);

  if (!wm.autoConnect("Pastillero")) {
    ESP.restart();
  }

  ipLocal = WiFi.localIP().toString();
  mostrarMensaje("WiFi Conectado!", ipLocal);
  delay(1500);

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  if (MDNS.begin("pastillero")) {
    MDNS.addService("http", "tcp", 80);
  }

  iniciarServidorHTTP();
}

void loop() {
  server.handleClient();

  unsigned long ahora = millis();
  if (ahora - ultimoChequeo >= INTERVALO_CHEQUEO_MS) {
    ultimoChequeo = ahora;
    mostrarHoraActual();
    revisarHorarios();
  }
}