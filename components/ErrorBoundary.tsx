import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{children: React.ReactNode}, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Uncaught Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>CRASH DÉTECTÉ</Text>
          <ScrollView style={styles.scroll}>
            <Text style={styles.error}>{this.state.error?.toString()}</Text>
          </ScrollView>
          <TouchableOpacity 
            style={styles.btn} 
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={styles.btnText}>RÉESSAYER</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#18181b', padding: 20, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#ef4444', fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  scroll: { maxHeight: 200, width: '100%', backgroundColor: '#000', padding: 10, borderRadius: 8, marginBottom: 20 },
  error: { color: 'white', fontFamily: 'monospace' },
  btn: { backgroundColor: '#3b82f6', padding: 15, borderRadius: 8 },
  btnText: { color: 'white', fontWeight: 'bold' }
});
