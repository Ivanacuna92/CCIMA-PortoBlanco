import { useState, useEffect } from 'react';
import { PhoneOutgoing } from 'lucide-react';

function ActiveCallsFloat({ activeCallsCount = 0 }) {
    const [bars, setBars] = useState([40, 70, 50, 80]);

    // Animar las barras del ecualizador
    useEffect(() => {
        if (activeCallsCount === 0) return;

        const interval = setInterval(() => {
            setBars(prev => prev.map(() => Math.random() * 60 + 30));
        }, 300);
        return () => clearInterval(interval);
    }, [activeCallsCount]);

    if (activeCallsCount === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center space-x-4">
                {/* Icono con ping */}
                <div className="relative flex items-center justify-center">
                    <span className="absolute flex h-12 w-12">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-30"></span>
                    </span>
                    <PhoneOutgoing className="relative h-7 w-7" />
                </div>

                {/* Texto */}
                <div>
                    <p className="text-sm font-medium opacity-90">Llamadas en curso</p>
                    <p className="text-2xl font-bold">
                        {activeCallsCount} {activeCallsCount === 1 ? 'llamada' : 'llamadas'}
                    </p>
                </div>

                {/* Barras de progreso animadas (tipo ecualizador) */}
                <div className="flex items-end space-x-1 h-8">
                    {bars.map((height, i) => (
                        <div
                            key={i}
                            className="w-1.5 bg-white rounded-full transition-all duration-300 ease-in-out"
                            style={{ height: `${height}%` }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default ActiveCallsFloat;
