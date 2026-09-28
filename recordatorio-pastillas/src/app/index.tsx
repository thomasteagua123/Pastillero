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

export default function Inicio() {
  const [tipo, setTipo] = useState("");
  const [hora, setHora] = useState("");
  const [diasSeleccionados, setDiasSeleccionados] = useState<string[]>([]);
  const [ipEsp, setIpEsp] = useState("10.56.16.34");
  const [cargando, setCargando] = useState(false);

  const [medicamentos, setMedicamentos] = useState<Medicamento[]>([]);

  const seleccionarDia = (dia: string) => {
    if (diasSeleccionados.includes(dia)) {
      setDiasSeleccionados(diasSeleccionados.filter((d) => d !== dia));
    } else {
      setDiasSeleccionados([...diasSeleccionados, dia]);
    }
  };

  const peticionConTimeout = async (url: string, opciones: RequestInit, timeoutMs = 6000) => {
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

  const probarConexion = async () => {
    setCargando(true);
    try {
      const response = await peticionConTimeout(`http://${ipEsp}/conectar`, {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        Alert.alert("¡Conexión Exitosa!", `Respuesta ESP32: ${data.mensaje}`);
      } else {
        Alert.alert("Error de Respuesta", `El ESP32 respondió con código ${response.status}`);
      }
    } catch (error) {
      Alert.alert(
        "Error de Conexión",
        `No se pudo conectar a http://${ipEsp}/conectar. Verificá la IP y que estés en la misma red.`
      );
    } finally {
      setCargando(false);
    }
  };

  const enviarHorarioAESP32 = async (horaNum: number, minutoNum: number) => {
    setCargando(true);
    const ahora = new Date();
    const epochLocalSec = Math.floor((ahora.getTime() - (ahora.getTimezoneOffset() * 60000)) / 1000);

    try {
      const response = await peticionConTimeout(`http://${ipEsp}/horario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          hora: horaNum, 
          minuto: minutoNum,
          epoch: epochLocalSec
        }),
      });

      if (response.ok) {
        Alert.alert("¡Enviado!", `Orden enviada al ESP32 (${horaNum}:${minutoNum}). Dispensando...`);
      } else {
        Alert.alert("Error ESP32", "El ESP32 no pudo procesar la solicitud.");
      }
    } catch (error) {
      Alert.alert(
        "Sin conexión",
        `No se pudo conectar a http://${ipEsp}. Verificá la red Wi-Fi.`
      );
    } finally {
      setCargando(false);
    }
  };

  const sincronizarHoraTelefono = async () => {
    setCargando(true);
    const ahora = new Date();
    const epochLocalSec = Math.floor((ahora.getTime() - (ahora.getTimezoneOffset() * 60000)) / 1000);

    try {
      const response = await peticionConTimeout(`http://${ipEsp}/synctime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epoch: epochLocalSec }),
      });

      if (response.ok) {
        Alert.alert("Éxito", "Hora del celular sincronizada en la ESP32.");
      } else {
        Alert.alert("Error", "No se pudo sincronizar la hora.");
      }
    } catch (error) {
      Alert.alert("Error de conexión", `Imposible contactar con http://${ipEsp}`);
    } finally {
      setCargando(false);
    }
  };

  const agregarMedicamento = () => {
    if (!tipo.trim() || !hora.trim() || diasSeleccionados.length === 0) {
      Alert.alert("Atención", "Completá todos los campos antes de guardar.");
      return;
    }

    const partesHora = hora.split(":");
    if (partesHora.length !== 2) {
      Alert.alert("Formato inválido", "Usa el formato HH:MM (ej. 17:30)");
      return;
    }

    const horaNum = parseInt(partesHora[0], 10);
    const minutoNum = parseInt(partesHora[1], 10);

    if (isNaN(horaNum) || isNaN(minutoNum) || horaNum < 0 || horaNum > 23 || minutoNum < 0 || minutoNum > 59) {
      Alert.alert("Hora inválida", "Ingresá valores entre 00:00 y 23:59");
      return;
    }

    const nuevoMedicamento: Medicamento = {
      id: Date.now(),
      tipo: tipo.trim(),
      hora: hora.trim(),
      dias: diasSeleccionados,
    };

    setMedicamentos([...medicamentos, nuevoMedicamento]);
    enviarHorarioAESP32(horaNum, minutoNum);

    setTipo("");
    setHora("");
    setDiasSeleccionados([]);
  };

  const eliminarMedicamento = (id: number) => {
    setMedicamentos(medicamentos.filter((m) => m.id !== id));
  };

  return (
    <ScrollView style={styles.pantalla} contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>💊 Control de Pastillero</Text>
      <Text style={styles.subtitulo}>Programá tus tomas diarias</Text>

      {/* SECCIÓN CONFIGURACIÓN IP Y HERRAMIENTAS */}
      <View style={styles.configIpContainer}>
        <Text style={styles.etiqueta}>IP de la ESP32 (ver en pantalla LCD)</Text>
        <TextInput
          style={styles.input}
          placeholder="10.56.16.34"
          value={ipEsp}
          onChangeText={setIpEsp}
          keyboardType="numeric"
        />

        <TouchableOpacity
          style={[styles.botonManual, { backgroundColor: "#2196F3" }, cargando && styles.botonDeshabilitado]}
          onPress={probarConexion}
          disabled={cargando}
        >
          {cargando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.textoBotonSecundario}>🔌 Conectar</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.botonManual, { backgroundColor: "#009688", marginTop: 8 }, cargando && styles.botonDeshabilitado]}
          onPress={sincronizarHoraTelefono}
          disabled={cargando}
        >
          <Text style={styles.textoBotonSecundario}>🕒 Sincronizar Hora Celular</Text>
        </TouchableOpacity>
      </View>

      {/* FORMULARIO DE REGISTRO */}
      <View style={styles.formulario}>
        <Text style={styles.etiqueta}>Nombre / Medicamento</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Ibuprofeno"
          value={tipo}
          onChangeText={setTipo}
        />

        <Text style={styles.etiqueta}>Hora (HH:MM)</Text>
        <TextInput
          style={styles.input}
          placeholder="17:30"
          value={hora}
          onChangeText={setHora}
          keyboardType="numbers-and-punctuation"
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
                <Text style={[styles.textoDia, seleccionado && styles.textoDiaSeleccionado]}>
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
          <Text style={styles.textoBoton}>+ Guardar y Sincronizar</Text>
        </TouchableOpacity>
      </View>

      {/* LISTA DE MEDICAMENTOS */}
      <Text style={styles.tituloLista}>Pastillas Programadas</Text>

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
              <Text style={styles.diasMedicamento}>📅 {item.dias.join(", ")}</Text>
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
  titulo: { fontSize: 26, fontWeight: "bold", textAlign: "center", color: "#1a1a1a" },
  subtitulo: { fontSize: 14, color: "#666", textAlign: "center", marginBottom: 20 },
  configIpContainer: { backgroundColor: "#e3f2fd", padding: 15, borderRadius: 12, marginBottom: 20 },
  formulario: { backgroundColor: "white", padding: 18, borderRadius: 14, marginBottom: 25 },
  etiqueta: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10, fontSize: 15, backgroundColor: "#fff" },
  diasContainer: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  dia: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#fff" },
  diaSeleccionado: { backgroundColor: "#2196F3", borderColor: "#2196F3" },
  textoDia: { fontWeight: "600", color: "#555", fontSize: 12 },
  textoDiaSeleccionado: { color: "white" },
  botonAgregar: { backgroundColor: "#4CAF50", padding: 14, borderRadius: 10, marginTop: 18 },
  botonDeshabilitado: { opacity: 0.6 },
  textoBoton: { color: "white", textAlign: "center", fontSize: 16, fontWeight: "bold" },
  botonManual: { backgroundColor: "#ff9800", padding: 12, borderRadius: 8, marginTop: 10 },
  textoBotonSecundario: { color: "white", textAlign: "center", fontWeight: "bold" },
  tituloLista: { fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  sinMedicamentos: { backgroundColor: "white", padding: 16, borderRadius: 10 },
  textoVacio: { color: "#888", textAlign: "center" },
  fila: { backgroundColor: "white", borderRadius: 10, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center" },
  informacion: { flex: 1 },
  tipoMedicamento: { fontSize: 16, fontWeight: "bold", color: "#222" },
  horaMedicamento: { fontSize: 14, color: "#444", marginTop: 2 },
  diasMedicamento: { fontSize: 12, color: "#777", marginTop: 2 },
  botonEliminar: { backgroundColor: "#ef5350", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6 },
  textoEliminar: { color: "white", fontSize: 12, fontWeight: "bold" },
});