#include <bits/stdc++.h>
#include <sys/resource.h>
using namespace std;
class solution{
public:
    vector<int> identifyRitualPair(vector<int>& elements,int goal){
        unordered_map<int,int> seen;
        for(int i=0;i<(int)elements.size();i++){
            int num=elements[i];
            int complement=goal-num;
            if(seen.find(complement)!=seen.end()){
                return {seen[complement],i};
            }
            seen[num]=i;
        }
        return {};
    }
};
int main(){
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    int n;
    cin>>n;
    vector<int> elements(n);
    for(int i=0;i<n;i++) cin>>elements[i];
    int goal;
    cin>>goal;
    solution sol;
    vector<int> result=sol.identifyRitualPair(elements,goal);
    if(!result.empty()){
        cout<<result[0]<<" "<<result[1]<<"\n";
    }else{
        cout<<-1<<"\n";
    }
    return 0;
}