import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

const actions = [
  ['Attendance','✓'],
  ['Leave','▤'],
  ['Issues','!'],
  ['Recovery','₹'],
  ['Rate List','₹'],
  ['Create Order','+'],
  ['Assigned Parties','◎'],
  ['Plan Route','⌖'],
];

export default function CrmHomeScreen({token,apiUrl,user,activeLogId,onNavigateToAttendance,onNavigateToLeave,onNavigateToIssues,onNavigateToRecovery,onNavigateToProducts,onNavigateToOrder,onNavigateToParties,onNavigateToRoutePlanner}) {
  const [stats,setStats]=useState({visits:0,collection:0}),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false);
  const load=useCallback(async()=>{try{
    const [visitsResponse,collectionsResponse]=await Promise.all([
      fetch(`${apiUrl}/visit/my/today`,{headers:{Authorization:`Bearer ${token}`}}),
      fetch(`${apiUrl}/collection/my?limit=500`,{headers:{Authorization:`Bearer ${token}`}}),
    ]);
    const [visitsResult,collectionsResult]=await Promise.all([visitsResponse.json(),collectionsResponse.json()]);
    const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
    const collections=Array.isArray(collectionsResult.data)?collectionsResult.data:[];
    setStats({
      visits:Array.isArray(visitsResult.data)?visitsResult.data.length:0,
      collection:collections.filter(item=>new Date(item.collectionDate||item.createdAt)>=monthStart).reduce((sum,item)=>sum+Number(item.amount||0),0),
    });
  }finally{setLoading(false);setRefreshing(false)}},[apiUrl,token]);
  useEffect(()=>{load()},[load]);
  const handlers={'Attendance':onNavigateToAttendance,'Leave':onNavigateToLeave,'Issues':onNavigateToIssues,'Recovery':onNavigateToRecovery,'Rate List':onNavigateToProducts,'Create Order':onNavigateToOrder,'Assigned Parties':onNavigateToParties,'Plan Route':onNavigateToRoutePlanner};
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load()}} colors={['#00796B']}/>}>
    <View style={s.welcome}><View><Text style={s.eyebrow}>CRM WORKSPACE</Text><Text style={s.title}>Hello, {user?.name||'CRM Manager'}</Text><Text style={s.subtitle}>Customer visits, collections and issue resolution</Text></View><View style={[s.online,activeLogId&&s.onlineActive]}><Text style={s.onlineText}>{activeLogId?'ON DUTY':'OFF DUTY'}</Text></View></View>
    {loading?<ActivityIndicator color="#00796B" style={{margin:30}}/>:<View style={s.stats}><View style={s.stat}><Text style={s.statLabel}>Parties Visited Today</Text><Text style={s.statValue}>{stats.visits}</Text><Text style={s.statHint}>Completed and ongoing visits</Text></View><View style={s.stat}><Text style={s.statLabel}>Collection This Month</Text><Text style={s.statValue}>₹{stats.collection.toLocaleString('en-IN')}</Text><Text style={s.statHint}>Money collected by you</Text></View></View>}
    <View style={s.card}><Text style={s.cardTitle}>Quick Actions</Text><View style={s.grid}>{actions.map(([label,icon])=><TouchableOpacity key={label} style={s.action} onPress={handlers[label]}><View style={s.icon}><Text style={s.iconText}>{icon}</Text></View><Text style={s.actionText}>{label}</Text></TouchableOpacity>)}</View></View>
    <View style={s.focus}><Text style={s.focusTitle}>Today’s CRM Focus</Text><Text style={s.focusText}>Open Assigned Parties to view profiles, outstanding bills, collect money, create orders or raise customer issues.</Text></View>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F7F9FC'},body:{padding: scale(16),paddingBottom: verticalScale(42)},welcome:{backgroundColor:'#0F766E',borderRadius:18,padding: scale(18),flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},eyebrow:{fontSize: responsiveFontSize(10),fontWeight:'800',letterSpacing:1.4,color:'#99F6E4'},title:{fontSize: responsiveFontSize(22),fontWeight:'900',color:'#fff',marginTop: verticalScale(5)},subtitle:{fontSize: responsiveFontSize(12),color:'#CCFBF1',marginTop: verticalScale(5),maxWidth:240},online:{backgroundColor:'rgba(255,255,255,.18)',paddingHorizontal: scale(9),paddingVertical: verticalScale(6),borderRadius:20},onlineActive:{backgroundColor:'#16A34A'},onlineText:{fontSize: responsiveFontSize(9),fontWeight:'900',color:'#fff'},stats:{flexDirection:'row',gap: verticalScale(12),marginTop: verticalScale(14)},stat:{flex:1,backgroundColor:'#fff',borderRadius:14,padding: scale(15),borderWidth:1,borderColor:'#E2E8F0'},statLabel:{fontSize: responsiveFontSize(11),color:'#718096',fontWeight:'700'},statValue:{fontSize: responsiveFontSize(22),color:'#1A202C',fontWeight:'900',marginTop: verticalScale(7)},statHint:{fontSize: responsiveFontSize(10),color:'#A0AEC0',marginTop: verticalScale(5)},card:{backgroundColor:'#fff',borderRadius:16,padding: scale(16),marginTop: verticalScale(14),borderWidth:1,borderColor:'#E2E8F0'},cardTitle:{fontSize: responsiveFontSize(16),fontWeight:'900',color:'#1A202C',marginBottom: verticalScale(14)},grid:{flexDirection:'row',flexWrap:'wrap',rowGap: verticalScale(18)},action:{width:'33.33%',alignItems:'center'},icon:{width: scale(50),height: verticalScale(50),borderRadius:25,backgroundColor:'#E6FFFA',borderWidth:1,borderColor:'#81E6D9',alignItems:'center',justifyContent:'center'},iconText:{fontSize: responsiveFontSize(21),fontWeight:'900',color:'#00796B'},actionText:{fontSize: responsiveFontSize(11),color:'#2D3748',fontWeight:'700',marginTop: verticalScale(7),textAlign:'center'},focus:{backgroundColor:'#FFFBEB',borderColor:'#FDE68A',borderWidth:1,borderRadius:14,padding: scale(15),marginTop: verticalScale(14)},focusTitle:{fontWeight:'900',color:'#92400E'},focusText:{fontSize: responsiveFontSize(12),color:'#A16207',lineHeight:18,marginTop: verticalScale(5)}});
