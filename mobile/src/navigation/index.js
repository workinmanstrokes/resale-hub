import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../context/AuthContext';
import SearchScreen from '../screens/SearchScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import SellScreen from '../screens/SellScreen';
import MyListingsScreen from '../screens/MyListingsScreen';
import PublishScreen from '../screens/PublishScreen';
import AccountScreen from '../screens/AccountScreen';

const Tab = createBottomTabNavigator();
const SearchStackNav = createNativeStackNavigator();
const SellStackNav = createNativeStackNavigator();
const ListingsStackNav = createNativeStackNavigator();
const AccountStackNav = createNativeStackNavigator();

function RequireLogin({ message }) {
  const navigation = useNavigation();
  return (
    <View style={styles.guard}>
      <Text style={styles.guardText}>{message}</Text>
      <Pressable
        style={styles.guardButton}
        onPress={() => navigation.getParent()?.navigate('AccountTab')}
      >
        <Text style={styles.guardButtonText}>Go to Account</Text>
      </Pressable>
    </View>
  );
}

function SellStack() {
  const { isLoggedIn } = useAuth();
  return (
    <SellStackNav.Navigator>
      {isLoggedIn ? (
        <>
          <SellStackNav.Screen name="Sell" component={SellScreen} options={{ title: 'Sell an item' }} />
          <SellStackNav.Screen name="Publish" component={PublishScreen} options={{ title: 'Publish' }} />
        </>
      ) : (
        <SellStackNav.Screen name="SellLoginRequired" options={{ title: 'Sell' }}>
          {() => <RequireLogin message="Log in to create and publish listings." />}
        </SellStackNav.Screen>
      )}
    </SellStackNav.Navigator>
  );
}

function MyListingsStack() {
  const { isLoggedIn } = useAuth();
  return (
    <ListingsStackNav.Navigator>
      {isLoggedIn ? (
        <>
          <ListingsStackNav.Screen name="MyListings" component={MyListingsScreen} options={{ title: 'My Listings' }} />
          <ListingsStackNav.Screen name="Publish" component={PublishScreen} options={{ title: 'Publish' }} />
        </>
      ) : (
        <ListingsStackNav.Screen name="ListingsLoginRequired" options={{ title: 'My Listings' }}>
          {() => <RequireLogin message="Log in to see and manage your listings." />}
        </ListingsStackNav.Screen>
      )}
    </ListingsStackNav.Navigator>
  );
}

function SearchStack() {
  return (
    <SearchStackNav.Navigator>
      <SearchStackNav.Screen name="Search" component={SearchScreen} options={{ title: 'Find a deal' }} />
      <SearchStackNav.Screen name="ItemDetail" component={ItemDetailScreen} options={{ title: 'Compare prices' }} />
    </SearchStackNav.Navigator>
  );
}

function AccountStack() {
  return (
    <AccountStackNav.Navigator>
      <AccountStackNav.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
    </AccountStackNav.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="SearchTab" component={SearchStack} options={{ title: 'Search' }} />
        <Tab.Screen name="SellTab" component={SellStack} options={{ title: 'Sell' }} />
        <Tab.Screen name="MyListingsTab" component={MyListingsStack} options={{ title: 'Listings' }} />
        <Tab.Screen name="AccountTab" component={AccountStack} options={{ title: 'Account' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  guard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  guardText: { color: '#64748b', textAlign: 'center', marginBottom: 16 },
  guardButton: { backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  guardButtonText: { color: '#fff', fontWeight: '700' },
});
