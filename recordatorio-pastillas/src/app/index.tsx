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
  estado: "Pendiente" | "Tomada";
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
  const [mostrarManual, setMostrarManual] = useState(true);

  const peticionConTimeout = async (
    url: string,
    opciones: RequestInit,
    timeoutMs = 2500
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

  const cargarAlarmasDesdeESP32 = async (ip: string) => {
    if (!ip) return;
    try {
      const res = await peticionConTimeout(`http://${ip}/alarmas`, { method: "GET" }, 2000);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const alarmasCargadas: Medicamento[] = data.map((item: any, index: number) => {
            const hNum = typeof item.hora === "number" ? item.hora : 0;
            const mNum = typeof item.minuto === "number" ? item.minuto : 0;
            const hStr = hNum < 10 ? `0${hNum}` : `${hNum}`;
            const mStr = mNum < 10 ? `0${mNum}` : `${mNum}`;
            
            return {
              id: item.id || (Date.now() + index),
              tipo: item.tipo || "Medicamento",
              hora: `${hStr}:${mStr}`,
              dias: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
              estado: item.estado === "Tomada" ? "Tomada" : "Pendiente",
            };
          });
          setMedicamentos(alarmasCargadas);
        } else {
          setMedicamentos([]);
        }
      }
    } catch (e) {
      console.log("No se pudieron consultar las alarmas guardadas.");
    }
  };

  const buscarPastilleroEnRed = async () => {
    setBuscando(true);
    const destinosDirectos = ["pastillero.local", "192.168.4.1"];
    
    for (const host of destinosDirectos) {
      try {
        const res = await peticionConTimeout(`http://${host}/identificar`, { method: "GET" }, 1500);
        if (res.ok) {
          const data = await res.json();
          if (data && data.dispositivo === "pastillero_esp32") {
            const ipFinal = data.ip || host;
            setIpEsp(ipFinal);
            Alert.alert("¡Encontrado!", `Conectado a la ESP32 en ${host}`);
            await cargarAlarmasDesdeESP32(ipFinal);
            setBuscando(false);
            return;
          }
        }
      } catch (e) {}
    }

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
            peticionConTimeout(`http://${ipProbar}/identificar`, { method: "GET" }, 800)
              .then(async (res) => {
                if (res.ok) {
                  const data = await res.json();
                  if (data && data.dispositivo === "pastillero_esp32") return ipProbar;
                }
                return null;
              })
              .catch(() => null)
          )
        );

        const ipEncontrada = resultados.find((ip) => ip !== null);
        if (ipEncontrada) {
          setIpEsp(ipEncontrada);
          Alert.alert("¡Encontrado!", `Pastillero detectado en ${ipEncontrada}`);
          await cargarAlarmasDesdeESP32(ipEncontrada);
          encontrado = true;
          break;
        }
      }
    }

    if (!encontrado) {
      Alert.alert("No encontrado", "Verifica que el celular y la ESP32 compartan la misma red Wi-Fi.");
    }
    setBuscando(false);
  };

  const probarConexion = async () => {
    if (!ipEsp) {
      Alert.alert("Atención", "Primero debes vincular el pastillero.");
      return;
    }
    setCargando(true);
    try {
      const res = await peticionConTimeout(`http://${ipEsp}/conectar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, 3000);
      
      if (res.ok) {
        Alert.alert("¡Conexión Exitosa!", "La comunicación con la ESP32 funciona correctamente.");
        await cargarAlarmasDesdeESP32(ipEsp);
      } else {
        Alert.alert("Error", "El dispositivo respondió con un error de servidor.");
      }
    } catch (e) {
      Alert.alert("Error de comunicación", "No se pudo comunicar con el pastillero.");
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
    idAlarma: number,
    nombreMed: string,
    horaNum: number,
    minutoNum: number,
    diasArray: string[]
  ) => {
    if (!ipEsp) return;
    try {
      const ahora = new Date();
      await peticionConTimeout(`http://${ipEsp}/horario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: idAlarma,
          tipo: nombreMed,
          hora: horaNum,
          minuto: minutoNum,
          dias: diasArray,
          epoch: Math.floor(ahora.getTime() / 1000),
        }),
      });
    } catch (error) {
      console.log("Error al sincronizar alarma con ESP32");
    }
  };

  const agregarMedicamento = () => {
    if (!tipo.trim() || !hora.trim() || diasSeleccionados.length === 0) {
      Alert.alert("Atención", "Por favor completa todos los campos.");
      return;
    }

    const partes = hora.split(":");
    if (partes.length !== 2) {
      Alert.alert("Formato incorrecto", "Usa HH:MM");
      return;
    }

    const hNum = parseInt(partes[0], 10);
    const mNum = parseInt(partes[1], 10);

    const nuevoId = Date.now();
    const nuevoMedicamento: Medicamento = {
      id: nuevoId,
      tipo: tipo.trim(),
      hora: hora.trim(),
      dias: diasSeleccionados,
      estado: "Pendiente",
    };

    setMedicamentos((prev) => (Array.isArray(prev) ? [...prev, nuevoMedicamento] : [nuevoMedicamento]));
    enviarHorarioAESP32(nuevoId, tipo.trim(), hNum, mNum, diasSeleccionados);

    setTipo("");
    setHora("");
    setDiasSeleccionados([]);
  };

  const eliminarMedicamento = async (id: number) => {
    setMedicamentos((prev) => (Array.isArray(prev) ? prev.filter((m) => m.id !== id) : []));
    if (!ipEsp) return;
    try {
      await peticionConTimeout(`http://${ipEsp}/borrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.log("No se pudo eliminar la alarma en la ESP32");
    }
  };

  return (
    <ScrollView style={styles.pantalla} contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>💊 Control de Pastillero</Text>
      <Text style={styles.subtitulo}>Asistente Automatizado de Medicación</Text>

      {/* GUÍA MANUAL */}
      <View style={styles.manualContainer}>
        <TouchableOpacity style={styles.manualHeader} onPress={() => setMostrarManual(!mostrarManual)}>
          <Text style={styles.manualTitulo}>📖 Guía de Carga Física</Text>
          <Text style={styles.manualToggleText}>{mostrarManual ? "Ocultar ▲" : "Ver guía ▼"}</Text>
        </TouchableOpacity>

        {mostrarManual && (
          <View style={styles.manualCuerpo}>
            <Text style={styles.pasoTexto}>⚠️ Compartimento 1: VACÍO (Posición de inicio).</Text>
            <Text style={styles.pasoTexto}>✅ Carga de pastillas del 2 al 8 (máximo 7).</Text>
          </View>
        )}
      </View>

      {/* ESTADO DE CONEXIÓN */}
      <View style={styles.configIpContainer}>
        <Text style={styles.textoEstado}>
          {ipEsp ? `✅ Conectado a: ${ipEsp}` : "⚠ Pastillero no detectado"}
        </Text>
        <TouchableOpacity style={styles.botonBuscar} onPress={buscarPastilleroEnRed} disabled={buscando}>
          {buscando ? <ActivityIndicator color="#fff" /> : <Text style={styles.textoBoton}>🔍 Buscar Pastillero</Text>}
        </TouchableOpacity>

        {ipEsp !== "" && (
          <TouchableOpacity
            style={[styles.botonBuscar, { backgroundColor: "#2196F3", marginTop: 8 }]}
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
        <TextInput style={styles.input} placeholder="Ej: Paracetamol" value={tipo} onChangeText={setTipo} />

        <Text style={styles.etiqueta}>Hora (HH:MM)</Text>
        <TextInput
          style={styles.input}
          placeholder="17:30"
          value={hora}
          onChangeText={setHora}
          keyboardType="default"
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
                <Text style={[styles.textoDia, seleccionado && styles.textoDiaSeleccionado]}>{dia}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.botonAgregar} onPress={agregarMedicamento}>
          <Text style={styles.textoBoton}>+ Guardar Horario</Text>
        </TouchableOpacity>
      </View>

      {/* VISUALIZACIÓN DE ESTADO DE ADHERENCIA */}
      <Text style={styles.tituloLista}>Estado de Medicación</Text>

      {!Array.isArray(medicamentos) || medicamentos.length === 0 ? (
        <View style={styles.sinMedicamentos}>
          <Text style={styles.textoVacio}>No hay medicamentos agendados.</Text>
        </View>
      ) : (
        medicamentos.map((item, index) => {
          const esTomada = item?.estado === "Tomada";
          const colorBadge = esTomada ? "#4CAF50" : "#ff9800"; // Verde si tomada, Naranja si pendiente

          return (
            <View style={styles.fila} key={item?.id || index}>
              <View style={styles.informacion}>
                <Text style={styles.tipoMedicamento}>{item?.tipo || "Sin nombre"}</Text>
                <Text style={styles.horaMedicamento}>🕐 {item?.hora || "00:00"} hs</Text>
                <Text style={styles.diasMedicamento}>📅 {item?.dias?.join(", ") || "Todos los días"}</Text>
                
                <View style={[styles.badgeEstado, { backgroundColor: colorBadge }]}>
                  <Text style={styles.textoBadge}>
                    {esTomada ? "✓ Pastilla tomada" : "⏳ Pendiente"}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.botonEliminar}
                onPress={() => item?.id && eliminarMedicamento(item.id)}
              >
                <Text style={styles.textoEliminar}>Borrar</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: "#f0f2f5" },
  contenedor: { padding: 20, paddingTop: 50, paddingBottom: 40 },
  titulo: { fontSize: 26, fontWeight: "bold", textAlign: "center", color: "#1a1a1a" },
  subtitulo: { fontSize: 14, color: "#666", textAlign: "center", marginBottom: 15 },
  manualContainer: { backgroundColor: "#fff3cd", borderRadius: 10, marginBottom: 15, overflow: "hidden" },
  manualHeader: { padding: 12, backgroundColor: "#ffe8a1", flexDirection: "row", justifyContent: "space-between" },
  manualTitulo: { fontSize: 14, fontWeight: "bold", color: "#856404" },
  manualToggleText: { fontSize: 12, color: "#856404" },
  manualCuerpo: { padding: 12 },
  pasoTexto: { fontSize: 12, color: "#555", marginBottom: 3 },
  configIpContainer: { backgroundColor: "#e3f2fd", padding: 12, borderRadius: 10, marginBottom: 15 },
  textoEstado: { fontSize: 14, fontWeight: "bold", color: "#2e7d32", marginBottom: 8 },
  botonBuscar: { backgroundColor: "#673AB7", padding: 10, borderRadius: 6, alignItems: "center" },
  formulario: { backgroundColor: "white", padding: 15, borderRadius: 12, marginBottom: 20 },
  etiqueta: { fontSize: 13, fontWeight: "600", color: "#333", marginBottom: 4, marginTop: 4 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 6, padding: 8, fontSize: 14, backgroundColor: "#fff" },
  diasContainer: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 4 },
  dia: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: "#fff" },
  diaSeleccionado: { backgroundColor: "#2196F3", borderColor: "#2196F3" },
  textoDia: { fontSize: 11, fontWeight: "600", color: "#555" },
  textoDiaSeleccionado: { color: "white" },
  botonAgregar: { backgroundColor: "#4CAF50", padding: 12, borderRadius: 8, marginTop: 15, alignItems: "center" },
  textoBoton: { color: "white", fontSize: 14, fontWeight: "bold" },
  tituloLista: { fontSize: 18, fontWeight: "bold", marginBottom: 10, color: "#333" },
  sinMedicamentos: { backgroundColor: "white", padding: 15, borderRadius: 8 },
  textoVacio: { color: "#888", textAlign: "center" },
  fila: { backgroundColor: "white", borderRadius: 10, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center" },
  informacion: { flex: 1 },
  tipoMedicamento: { fontSize: 16, fontWeight: "bold", color: "#222" },
  horaMedicamento: { fontSize: 13, color: "#444", marginTop: 2 },
  diasMedicamento: { fontSize: 12, color: "#777", marginTop: 2 },
  badgeEstado: { marginTop: 8, alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  textoBadge: { color: "white", fontSize: 12, fontWeight: "bold" },
  botonEliminar: { backgroundColor: "#ef5350", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  textoEliminar: { color: "white", fontSize: 12, fontWeight: "bold" },
});