#include <WiFi.h>
#include "time.h"
#include <sys/time.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WebServer.h>
#include <Preferences.h>

// --- DECLARACIONES GLOBALES ---
LiquidCrystal_I2C lcd(0x27, 16, 2);
WebServer server(80);
Preferences preferences;

// --- CONFIGURACIÓN DE RED (PON AQUÍ LOS DATOS DE TU HOTSPOT MÓVIL) ---
const char* WIFI_SSID     = "thomy";
const char* WIFI_PASSWORD = "thomas123";

// --- CONFIGURACIÓN NTP (Zona horaria Argentina UTC-3) ---
const char* NTP_SERVER1 = "ar.pool.ntp.org";
const char* NTP_SERVER2 = "south-america.pool.ntp.org";
const char* NTP_SERVER3 = "pool.ntp.org";
const long  GMT_OFFSET_SEC = -10800; // UTC-3 (3 * 3600 segundos)
const int   DAYLIGHT_OFFSET_SEC = 0;

// --- CONFIGURACIÓN DE PINES Y MOTOR ---
const int PIN_BUZZER = 13;
const int PIN_IN1 = 16;
const int PIN_IN2 = 17;
const int PIN_IN3 = 18;
const int PIN_IN4 = 19;

const int PASOS_POR_VUELTA = 4096;
const int CANTIDAD_COMPARTIMIENTOS = 8;
const int PASOS_POR_COMPARTIMIENTO = PASOS_POR_VUELTA / CANTIDAD_COMPARTIMIENTOS; // 512 pasos = 1 celda

// --- MEMORIA NVS ---
const char* NVS_NAMESPACE   = "horario_cfg";
const char* NVS_KEY_HORA    = "hora";
const char* NVS_KEY_MINUTO  = "minuto";

// --- VARIABLES GLOBALES ---
int horaDispensar   = 17;
int minutoDispensar = 16;
bool yaDisparado     = false;
int compartimientoActual = 0;
bool ntpSincronizado = false;

unsigned long ultimoChequeo = 0;
const unsigned long INTERVALO_CHEQUEO_MS = 1000;

// --- FUNCIONES DE MEMORIA NVS ---
void iniciarNVS() {
  preferences.begin(NVS_NAMESPACE, false); 
}

void guardarHorarioEnNVS(int hora, int minuto) {
  preferences.putInt(NVS_KEY_HORA, hora);
  preferences.putInt(NVS_KEY_MINUTO, minuto);
}

bool cargarHorarioDesdeNVS(int &horaOut, int &minutoOut) {
  if (!preferences.isKey(NVS_KEY_HORA) || !preferences.isKey(NVS_KEY_MINUTO)) {
    return false;
  }
  horaOut   = preferences.getInt(NVS_KEY_HORA, horaDispensar);
  minutoOut = preferences.getInt(NVS_KEY_MINUTO, minutoDispensar);
  return true;
}

// --- FUNCIONES DE RED Y NTP ---
void conectarWiFi() {
  WiFi.mode(WIFI_STA);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Conectando WiFi");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    intentos++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi OK. IP: " + WiFi.localIP().toString());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Conectado");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP().toString());
  } else {
    Serial.println("\nSin conexion WiFi.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Error Conexion");
  }
  delay(1200);
}

void iniciarNTP() {
  Serial.println("Iniciando sincronizacion NTP con el celular...");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sincronizando");
  lcd.setCursor(0, 1);
  lcd.print("Hora NTP...");

  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER1, NTP_SERVER2, NTP_SERVER3);

  struct tm timeinfo;
  int intentos = 0;

  while (!getLocalTime(&timeinfo) && intentos < 20) {
    delay(500);
    Serial.print(".");
    intentos++;
  }

  if (intentos < 20) {
    ntpSincronizado = true;
    Serial.println("\n>>> Sincronizacion NTP Exitosa! <<<");
    Serial.printf("Hora del servidor NTP: %02d:%02d:%02d\n", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Hora NTP OK!");
    lcd.setCursor(0, 1);
    char buf[16];
    snprintf(buf, sizeof(buf), "Hora: %02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    lcd.print(buf);
  } else {
    ntpSincronizado = false;
    Serial.println("\nError: NTP no respondio.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Error NTP");
  }
  delay(1500);
}

// --- FUNCIONES DE HORA ---
bool obtenerHoraActual(struct tm &timeinfo) {
  return getLocalTime(&timeinfo);
}

void mostrarHoraActual() {
  struct tm timeinfo;
  if (obtenerHoraActual(timeinfo)) {
    char buffer[17];
    snprintf(buffer, sizeof(buffer), "%02d:%02d:%02d",
             timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    lcd.setCursor(0, 0);
    lcd.print("Hora actual:    ");
    lcd.setCursor(0, 1);
    lcd.print(buffer);
    lcd.print("        ");
  }
}

// --- HARDWARE, MOTOR Y ALARMA ---
void activarBuzzer() {
  for (int i = 0; i < 3; i++) {
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
  Serial.println("Girando motor 1 celda (512 pasos)...");
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

void mostrarMensaje(String linea1, String linea2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(linea1);
  lcd.setCursor(0, 1);
  lcd.print(linea2);
}

void dispensarPastilla() {
  mostrarMensaje("Hora de tomar", "la medicacion");
  activarBuzzer();
  girarUnaCelda();
  delay(1500);
}

void revisarHorario() {
  struct tm timeinfo;
  if (!obtenerHoraActual(timeinfo)) return;

  if (timeinfo.tm_hour == horaDispensar && timeinfo.tm_min == minutoDispensar) {
    if (!yaDisparado) {
      dispensarPastilla();
      yaDisparado = true;
    }
  } else {
    yaDisparado = false;
  }
}

// --- SERVIDOR HTTP ---
void enviarHeadersCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleOptions() {
  enviarHeadersCORS();
  server.send(204);
}

void handleConectar() {
  enviarHeadersCORS();
  IPAddress clientIP = server.client().remoteIP();
  Serial.println("Conexion desde cliente IP: " + clientIP.toString());
  mostrarMensaje("App Conectada!", clientIP.toString());
  server.send(200, "application/json", "{\"status\":\"ok\",\"mensaje\":\"Conexion OK con ESP32\"}");
}

void handleSetHorario() {
  enviarHeadersCORS();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"body vacio\"}");
    return;
  }

  String body = server.arg("plain");
  int idxHora   = body.indexOf("\"hora\"");
  int idxMinuto = body.indexOf("\"minuto\"");

  if (idxHora == -1 || idxMinuto == -1) {
    server.send(400, "application/json", "{\"error\":\"Se requieren hora y minuto\"}");
    return;
  }

  int dosPuntosHora   = body.indexOf(':', idxHora);
  int dosPuntosMinuto = body.indexOf(':', idxMinuto);

  int hora   = body.substring(dosPuntosHora + 1).toInt();
  int minuto = body.substring(dosPuntosMinuto + 1).toInt();

  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) {
    server.send(400, "application/json", "{\"error\":\"Hora invalida\"}");
    return;
  }

  horaDispensar   = hora;
  minutoDispensar = minuto;
  yaDisparado     = true;

  guardarHorarioEnNVS(horaDispensar, minutoDispensar);

  char buffer[17];
  snprintf(buffer, sizeof(buffer), "%02d:%02d", horaDispensar, minutoDispensar);
  mostrarMensaje("Nuevo Horario:", buffer);

  dispensarPastilla();

  char resp[80];
  snprintf(resp, sizeof(resp), "{\"status\":\"ok\",\"hora\":%d,\"minuto\":%d}", horaDispensar, minutoDispensar);
  server.send(200, "application/json", resp);
}

void handleDispensar() {
  enviarHeadersCORS();
  dispensarPastilla();
  server.send(200, "application/json", "{\"status\":\"ok\",\"accion\":\"dispensado\"}");
}

void iniciarServidorHTTP() {
  server.on("/conectar", HTTP_OPTIONS, handleOptions);
  server.on("/conectar", HTTP_POST, handleConectar);
  server.on("/conectar", HTTP_GET, handleConectar);

  server.on("/horario", HTTP_OPTIONS, handleOptions);
  server.on("/horario", HTTP_POST, handleSetHorario);

  server.on("/dispensar", HTTP_OPTIONS, handleOptions);
  server.on("/dispensar", HTTP_POST, handleDispensar);

  server.begin();
  Serial.println("Servidor HTTP iniciado.");
}

// --- SETUP Y LOOP ---
void setup() {
  Serial.begin(115200);

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);

  lcd.init();
  lcd.backlight();

  iniciarNVS();

  int horaGuardada, minutoGuardado;
  if (cargarHorarioDesdeNVS(horaGuardada, minutoGuardado)) {
    horaDispensar   = horaGuardada;
    minutoDispensar = minutoGuardado;
  }

  conectarWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    iniciarNTP();
  }

  iniciarServidorHTTP();
  mostrarMensaje("Pastillero", "Listo");
  delay(1000);
}

void loop() {
  server.handleClient();

  unsigned long ahora = millis();
  if (ahora - ultimoChequeo >= INTERVALO_CHEQUEO_MS) {
    ultimoChequeo = ahora;

    mostrarHoraActual();
    revisarHorario();

    if (WiFi.status() != WL_CONNECTED) {
      conectarWiFi();
    }
  }
}