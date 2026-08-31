import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

/**
 * A month grid for picking a date, with the past closed off.
 *
 * Dates used to be typed into a plain box that asked for "YYYY-MM-DD", which
 * accepts a typo, accepts yesterday, and accepts "31-02-2026". A cheque dated
 * before today is not a cheque anyone can bank, so those days are simply not
 * tappable.
 *
 * `minDate` defaults to today. Pass `null` to allow any day.
 */
export default function CalendarPicker({ value, onChange, minDate = 'today', label = 'Select a date' }) {
  const [month, setMonth] = useState(() => (value ? new Date(value) : new Date()));

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();

  const floor = minDate === 'today' ? new Date() : minDate ? new Date(minDate) : null;
  if (floor) floor.setHours(0, 0, 0, 0);

  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const format = (day) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const pretty = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '');

  return (
    <View style={s.calendar}>
      <View style={s.head}>
        <TouchableOpacity onPress={() => setMonth(new Date(year, monthIndex - 1, 1))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.nav}>‹</Text>
        </TouchableOpacity>
        <Text style={s.title}>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text>
        <TouchableOpacity onPress={() => setMonth(new Date(year, monthIndex + 1, 1))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.nav}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={s.weekRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={`${d}-${i}`} style={s.weekDay}>{d}</Text>)}
      </View>

      <View style={s.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`blank-${i}`} style={s.cell} />;
          const candidate = new Date(year, monthIndex, day);
          const disabled = Boolean(floor) && candidate < floor;
          const selected = value === format(day);
          return (
            <TouchableOpacity
              key={day}
              disabled={disabled}
              style={[s.cell, selected && s.selected]}
              onPress={() => onChange(format(day))}
            >
              <Text style={[s.dayText, disabled && s.disabled, selected && s.selectedText]}>{day}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.chosen}>{value ? `Selected: ${pretty(value)}` : label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  calendar: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(10) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: scale(6), marginBottom: verticalScale(6) },
  nav: { fontSize: responsiveFontSize(24), color: '#0F766E', fontWeight: '900', paddingHorizontal: scale(10) },
  title: { fontSize: responsiveFontSize(13), fontWeight: '800', color: '#0F172A' },
  weekRow: { flexDirection: 'row' },
  weekDay: { flex: 1, textAlign: 'center', fontSize: responsiveFontSize(10), fontWeight: '800', color: '#94A3B8', paddingVertical: verticalScale(4) },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  selected: { backgroundColor: '#0F766E' },
  dayText: { fontSize: responsiveFontSize(12), color: '#0F172A', fontWeight: '600' },
  disabled: { color: '#CBD5E1' },
  selectedText: { color: '#fff', fontWeight: '900' },
  chosen: { marginTop: verticalScale(6), textAlign: 'center', fontSize: responsiveFontSize(11), fontWeight: '700', color: '#0F766E' },
});
