import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

/**
 * A coordinate, or NaN when there isn't one.
 *
 * Number('') is 0, so a blank field would read as a real coordinate and put
 * the party at 0°,0° — in the Atlantic, and first in every route because it is
 * equally far from everything.
 */
const num=value=>(value===null||value===undefined||value==='' ? NaN : Number(value));
const coords=party=>({lat:num(party.location?.latitude??party.latitude),lng:num(party.location?.longitude??party.longitude)});
const valid=point=>Number.isFinite(point.lat)&&Number.isFinite(point.lng);
const distance=(a,b)=>Math.hypot(a.lat-b.lat,a.lng-b.lng);
const optimize=parties=>{if(parties.length<2)return parties;const remaining=[...parties],ordered=[remaining.shift()];while(remaining.length){const current=coords(ordered[ordered.length-1]);let best=0;for(let i=1;i<remaining.length;i++)if(distance(current,coords(remaining[i]))<distance(current,coords(remaining[best])))best=i;ordered.push(remaining.splice(best,1)[0])}return ordered};

export default function PartyRoutePlannerScreen({token,apiUrl,onBack}){
  const [parties,setParties]=useState([]),[selected,setSelected]=useState([]),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[route,setRoute]=useState([]);
  const load=useCallback(async()=>{try{const response=await fetch(`${apiUrl}/parties/my?limit=300`,{headers:{Authorization:`Bearer ${token}`}});const result=await response.json();if(!response.ok)throw new Error(result.message);setParties(Array.isArray(result.data)?result.data:[])}catch(error){Alert.alert('Route planner',error.message)}finally{setLoading(false);setRefreshing(false)}},[apiUrl,token]);
  useEffect(()=>{load()},[load]);
  const visible=useMemo(()=>parties.filter(p=>!search||`${p.partyName} ${p.area||''}`.toLowerCase().includes(search.toLowerCase())),[parties,search]);
  const toggle=id=>{setRoute([]);setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id])};
  const build=()=>{const chosen=parties.filter(p=>selected.includes(p._id)&&valid(coords(p)));if(chosen.length<2)return Alert.alert('Select parties','Select at least 2 parties.');setRoute(optimize(chosen))};
  const openMaps=async()=>{if(!route.length)return;const points=route.map(coords);const origin=`${points[0].lat},${points[0].lng}`,destination=`${points.at(-1).lat},${points.at(-1).lng}`,waypoints=points.slice(1,-1).map(p=>`${p.lat},${p.lng}`).join('|');const url=`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving${waypoints?`&waypoints=${encodeURIComponent(waypoints)}`:''}`;await Linking.openURL(url)};
  return <SafeAreaView style={s.safe}><View style={s.head}><TouchableOpacity onPress={onBack}><Text style={s.back}>‹ Back</Text></TouchableOpacity><View><Text style={s.title}>Party Route Planner</Text><Text style={s.sub}>Select parties and create an efficient visit order</Text></View></View>{loading?<ActivityIndicator style={{marginTop:50}} color="#00796B"/>:<ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load()}}/>}><TextInput style={s.search} placeholder="Search assigned parties" value={search} onChangeText={setSearch}/><Text style={s.count}>{selected.length} selected · {parties.filter(p=>valid(coords(p))).length} of {parties.length} have a location</Text>{parties.length===0&&<View style={s.emptyBox}><Text style={s.emptyTitle}>No parties assigned</Text><Text style={s.emptyText}>A route is built from the parties assigned to you. Ask an admin to set you as the CRM manager on the parties you handle.</Text></View>}{visible.map(p=>{
      /**
       * A party with no pin cannot be put in a route — there is nothing to
       * measure a distance from. It stays on the list and says so, because
       * dropping it silently made the whole screen look empty and gave the
       * CRM nothing to act on.
       */
      const pinned=valid(coords(p));
      return <TouchableOpacity key={p._id} style={[s.party,selected.includes(p._id)&&s.selected,!pinned&&s.unpinned]} disabled={!pinned} onPress={()=>toggle(p._id)}><View style={s.check}><Text>{selected.includes(p._id)?'✓':''}</Text></View><View style={{flex:1}}><Text style={s.name}>{p.partyName}</Text><Text style={s.address}>{p.area||p.address||'No area'}</Text>{!pinned&&<Text style={s.noPin}>No location pinned — cannot be routed</Text>}</View></TouchableOpacity>;
    })}<TouchableOpacity style={s.build} onPress={build}><Text style={s.buildText}>Create Optimized Route</Text></TouchableOpacity>{route.length>0&&<View style={s.route}><Text style={s.routeTitle}>Recommended Visit Sequence</Text>{route.map((p,i)=><Text key={p._id} style={s.stop}>{i+1}. {p.partyName}</Text>)}<TouchableOpacity style={s.maps} onPress={openMaps}><Text style={s.buildText}>Open Route in Maps</Text></TouchableOpacity></View>}</ScrollView>}</SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F7F9FC'},head:{padding: scale(16),backgroundColor:'#fff',borderBottomWidth:1,borderColor:'#E2E8F0',flexDirection:'row',gap: verticalScale(18),alignItems:'center'},back:{color:'#00796B',fontWeight:'700'},title:{fontSize: responsiveFontSize(19),fontWeight:'800'},sub:{fontSize: responsiveFontSize(12),color:'#718096'},body:{padding: scale(16),paddingBottom: verticalScale(50)},search:{backgroundColor:'#fff',borderWidth:1,borderColor:'#CBD5E0',borderRadius:9,padding: scale(12)},count:{marginVertical: verticalScale(12),color:'#4A5568',fontWeight:'700'},party:{backgroundColor:'#fff',padding: scale(13),borderRadius:10,marginBottom: verticalScale(9),flexDirection:'row',gap: verticalScale(12),alignItems:'center',borderWidth:1,borderColor:'#E2E8F0'},selected:{borderColor:'#00796B',backgroundColor:'#E6FFFA'},check:{width: scale(24),height: verticalScale(24),borderWidth:1,borderColor:'#00796B',borderRadius:5,alignItems:'center',justifyContent:'center'},name:{fontWeight:'800',color:'#1A202C'},address:{fontSize: responsiveFontSize(12),color:'#718096',marginTop: verticalScale(2)},unpinned:{opacity:0.55},noPin:{fontSize:10,color:'#B45309',fontWeight:'700',marginTop:2},emptyBox:{padding:28,alignItems:'center'},emptyTitle:{fontSize:16,fontWeight:'800',color:'#0F172A'},emptyText:{fontSize:12,color:'#64748B',textAlign:'center',marginTop:8,lineHeight:18},build:{backgroundColor:'#00796B',padding: scale(14),borderRadius:9,alignItems:'center',marginTop: verticalScale(10)},buildText:{color:'#fff',fontWeight:'800'},route:{backgroundColor:'#fff',padding: scale(15),borderRadius:12,marginTop: verticalScale(16)},routeTitle:{fontSize: responsiveFontSize(16),fontWeight:'800',marginBottom: verticalScale(10)},stop:{paddingVertical: verticalScale(7),borderBottomWidth:1,borderColor:'#EDF2F7'},maps:{backgroundColor:'#2B6CB0',padding: scale(13),borderRadius:8,alignItems:'center',marginTop: verticalScale(14)}});
