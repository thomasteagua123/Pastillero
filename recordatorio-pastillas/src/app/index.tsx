import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";

type Medicamento = {
  id: number;
  tipo: string;
  hora: string;
  dias: string[];
};

const diasSemana = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default function Index() {
  const [tipo, setTipo] = useState("");
  const [hora, setHora] = useState("");
  const [diasSeleccionados, setDiasSeleccionados] = useState<string[]>([]);

  const [ipEsp, setIpEsp] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [medicamentos, setMedicamentos] = useState<Medicamento[]>([]);

  // Función auxiliar para peticiones HTTP con tiempo de espera máximo
  const peticionConTimeout = async (
    url: string,
    opciones: RequestInit,
    timeoutMs = 2000
  ) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const respuesta = await fetch(url, {
        ...opciones,
        signal: controller.signal,
      });
      clearTimeout(id);
      return respuesta;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  };

  // Función para escanear y encontrar la ESP32 en la red doméstica
  const buscarPastilleroEnRed = async () => {
    setBuscando(true);

    // 1. Intentar por mDNS (pastillero.local) y por IP de AP directo
    const destinosDirectos = ["pastillero.local", "192.168.4.1"];
    for (const host of destinosDirectos) {
      try {
        const res = await peticionConTimeout(
          `http://${host}/identificar`,
          { method: "GET" },
          1500
        );
        if (res.ok) {
          const data = await res.json();
          if (data.dispositivo === "pastillero_esp32") {
            const ipFinal = data.ip || host;
            setIpEsp(ipFinal);
            Alert.alert("¡Encontrado!", `Conectado a la ESP32 en ${host}`);
            setBuscando(false);
            return;
          }
        }
      } catch (e) {}
    }

    // 2. Escaneo de la subred local por lotes (Chunks de 15 IPs simultáneas)
    const subredes = ["192.168.1.", "192.168.0."];
    let encontrado = false;

    for (const subred of subredes) {
      if (encontrado) break;

      const ips: string[] = [];
      for (let i = 2; i < 254; i++) ips.push(`${subred}${i}`);

      const TAMAÑO_LOTE = 15;
      for (let i = 0; i < ips.length; i += TAMAÑO_LOTE) {
        const lote = ips.slice(i, i + TAMAÑO_LOTE);

        const resultados = await Promise.all(
          lote.map((ipProbar) =>
            peticionConTimeout(
              `http://${ipProbar}/identificar`,
              { method: "GET" },
              1000
            )
              .then(async (res) => {
                if (res.ok) {
                  const data = await res.json();
                  if (data.dispositivo === "pastillero_esp32") return ipProbar;
                }
                return null;
              })
              .catch(() => null)
          )
        );

        const ipEncontrada = resultados.find((ip) => ip !== null);
        if (ipEncontrada) {
          setIpEsp(ipEncontrada);
          Alert.alert("¡Encontrado!", `Pastillero detectado en la IP ${ipEncontrada}`);
          encontrado = true;
          break;
        }
      }
    }

    if (!encontrado) {
      Alert.alert(
        "No encontrado",
        "Asegúrate de que el celular esté conectado a la misma red Wi-Fi de la ESP32."
      );
    }

    setBuscando(false);
  };

  const probarConexion = async () => {
    if (!ipEsp) return;
    setCargando(true);
    try {
      const res = await peticionConTimeout(`http://${ipEsp}/conectar`, {
        method: "POST",
      });
      if (res.ok) {
        Alert.alert(
          "¡Conectado!",
          "Comunicación exitosa confirmada por la ESP32."
        );
      }
    } catch (e) {
      Alert.alert("Error", "No se pudo establecer comunicación con el pastillero.");
    } finally {
      setCargando(false);
    }
  };

  const seleccionarDia = (dia: string) => {
    if (diasSeleccionados.includes(dia)) {
      setDiasSeleccionados(diasSeleccionados.filter((d) => d !== dia));
    } else {
      setDiasSeleccionados([...diasSeleccionados, dia]);
    }
  };

  const enviarHorarioAESP32 = async (
    nombreMed: string,
    horaNum: number,
    minutoNum: number,
    diasArray: string[]
  ) => {
    if (!ipEsp) {
      Alert.alert(
        "Guardado local",
        "Horario guardado en la app. Recuerda vincular la ESP32 para sincronizar la alarma física."
      );
      return;
    }

    setCargando(true);
    const ahora = new Date();

    try {
      const response = await peticionConTimeout(`http://${ipEsp}/horario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: nombreMed,
          hora: horaNum,
          minuto: minutoNum,
          dias: diasArray,
          mensaje: `Hora de tomar ${nombreMed}`,
          epoch: Math.floor(ahora.getTime() / 1000),
        }),
      });

      if (response.ok) {
        Alert.alert(
          "¡Alarma Enviada!",
          `Se programó ${nombreMed} para las ${horaNum}:${
            minutoNum < 10 ? "0" : ""
          }${minutoNum} hs.`
        );
      }
    } catch (error) {
      Alert.alert("Error de transmisión", "No se pudo enviar la alarma a la ESP32.");
    } finally {
      setCargando(false);
    }
  };

  const agregarMedicamento = () => {
    if (!tipo.trim() || !hora.trim() || diasSeleccionados.length === 0) {
      Alert.alert("Atención", "Por favor completa todos los campos.");
      return;
    }

    const partesHora = hora.split(":");
    if (partesHora.length !== 2) {
      Alert.alert("Formato incorrecto", "Escribe la hora con formato HH:MM (ejemplo: 17:30)");
      return;
    }

    const horaNum = parseInt(partesHora[0], 10);
    const minutoNum = parseInt(partesHora[1], 10);

    if (
      isNaN(horaNum) ||
      isNaN(minutoNum) ||
      horaNum < 0 ||
      horaNum > 23 ||
      minutoNum < 0 ||
      minutoNum > 59
    ) {
      Alert.alert("Hora no válida", "Ingresa un horario entre 00:00 y 23:59");
      return;
    }

    const nuevoMedicamento: Medicamento = {
      id: Date.now(),
      tipo: tipo.trim(),
      hora: hora.trim(),
      dias: diasSeleccionados,
    };

    setMedicamentos([...medicamentos, nuevoMedicamento]);
    enviarHorarioAESP32(tipo.trim(), horaNum, minutoNum, diasSeleccionados);

    setTipo("");
    setHora("");
    setDiasSeleccionados([]);
  };

  const eliminarMedicamento = (id: number) => {
    setMedicamentos(medicamentos.filter((m) => m.id !== id));
  };

  return (
    <ScrollView
      style={styles.pantalla}
      contentContainerStyle={styles.contenedor}
    >
      <Text style={styles.titulo}>💊 Control de Pastillero</Text>
      <Text style={styles.subtitulo}>Asistente Automatizado de Medicación</Text>

      {/* SECCIÓN DE VINCULACIÓN */}
      <View style={styles.configIpContainer}>
        <Text style={styles.etiqueta}>Estado del Dispositivo</Text>
        <Text style={styles.textoEstado}>
          {ipEsp ? `✅ Conectado a: ${ipEsp}` : "⚠ Pastillero no detectado"}
        </Text>

        <TouchableOpacity
          style={[styles.botonBuscar, buscando && styles.botonDeshabilitado]}
          onPress={buscarPastilleroEnRed}
          disabled={buscando}
        >
          {buscando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.textoBoton}>🔍 Buscar Pastillero (mDNS / Subred)</Text>
          )}
        </TouchableOpacity>

        {ipEsp !== "" && (
          <TouchableOpacity
            style={[
              styles.botonBuscar,
              { backgroundColor: "#2196F3", marginTop: 8 },
            ]}
            onPress={probarConexion}
            disabled={cargando}
          >
            <Text style={styles.textoBoton}>🔌 Probar Comunicación</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* FORMULARIO */}
      <View style={styles.formulario}>
        <Text style={styles.etiqueta}>Medicamento</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Paracetamol"
          value={tipo}
          onChangeText={setTipo}
        />

        <Text style={styles.etiqueta}>Hora (HH:MM)</Text>
        <TextInput
          style={styles.input}
          placeholder="17:30"
          value={hora}
          onChangeText={setHora}
          keyboardType="default" // Usa teclado normal alfanumérico
          maxLength={5}
        />

        <Text style={styles.etiqueta}>Días programados</Text>
        <View style={styles.diasContainer}>
          {diasSemana.map((dia) => {
            const seleccionado = diasSeleccionados.includes(dia);
            return (
              <TouchableOpacity
                key={dia}
                style={[styles.dia, seleccionado && styles.diaSeleccionado]}
                onPress={() => seleccionarDia(dia)}
              >
                <Text
                  style={[
                    styles.textoDia,
                    seleccionado && styles.textoDiaSeleccionado,
                  ]}
                >
                  {dia}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.botonAgregar, cargando && styles.botonDeshabilitado]}
          onPress={agregarMedicamento}
          disabled={cargando}
        >
          <Text style={styles.textoBoton}>+ Guardar Horario</Text>
        </TouchableOpacity>
      </View>

      {/* LISTA DE MEDICAMENTOS */}
      <Text style={styles.tituloLista}>Horarios Programados</Text>

      {medicamentos.length === 0 ? (
        <View style={styles.sinMedicamentos}>
          <Text style={styles.textoVacio}>No hay medicamentos agendados.</Text>
        </View>
      ) : (
        medicamentos.map((item) => (
          <View style={styles.fila} key={item.id}>
            <View style={styles.informacion}>
              <Text style={styles.tipoMedicamento}>{item.tipo}</Text>
              <Text style={styles.horaMedicamento}>🕐 {item.hora} hs</Text>
              <Text style={styles.diasMedicamento}>
                📅 {item.dias.join(", ")}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.botonEliminar}
              onPress={() => eliminarMedicamento(item.id)}
            >
              <Text style={styles.textoEliminar}>Borrar</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: "#f0f2f5" },
  contenedor: { padding: 20, paddingTop: 50, paddingBottom: 40 },
  titulo: {
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
    color: "#1a1a1a",
  },
  subtitulo: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  configIpContainer: {
    backgroundColor: "#e3f2fd",
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
  },
  textoEstado: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#2e7d32",
    marginBottom: 10,
  },
  botonBuscar: {
    backgroundColor: "#673AB7",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  formulario: {
    backgroundColor: "white",
    padding: 18,
    borderRadius: 14,
    marginBottom: 20,
  },
  etiqueta: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  diasContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  dia: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
  },
  diaSeleccionado: { backgroundColor: "#2196F3", borderColor: "#2196F3" },
  textoDia: { fontWeight: "600", color: "#555", fontSize: 12 },
  textoDiaSeleccionado: { color: "white" },
  botonAgregar: {
    backgroundColor: "#4CAF50",
    padding: 14,
    borderRadius: 10,
    marginTop: 18,
  },
  botonDeshabilitado: { opacity: 0.6 },
  textoBoton: {
    color: "white",
    textAlign: "center",
    fontSize: 15,
    fontWeight: "bold",
  },
  tituloLista: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
    color: "#333",
  },
  sinMedicamentos: { backgroundColor: "white", padding: 16, borderRadius: 10 },
  textoVacio: { color: "#888", textAlign: "center" },
  fila: {
    backgroundColor: "white",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  informacion: { flex: 1 },
  tipoMedicamento: { fontSize: 16, fontWeight: "bold", color: "#222" },
  horaMedicamento: { fontSize: 14, color: "#444", marginTop: 2 },
  diasMedicamento: { fontSize: 12, color: "#777", marginTop: 2 },
  botonEliminar: {
    backgroundColor: "#ef5350",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  textoEliminar: { color: "white", fontSize: 12, fontWeight: "bold" },
});