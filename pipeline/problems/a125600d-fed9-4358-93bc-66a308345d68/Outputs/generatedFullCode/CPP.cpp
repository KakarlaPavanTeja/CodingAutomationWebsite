#include <bits/stdc++.h>
#include <sys/resource.h>
using namespace std;
class solution{
public:
    vector<int> locatePairPositions(vector<int>& values,int required){
        unordered_map<int,int> seen;
        for(int i=0;i<(int)values.size();i++){
            int num=values[i];
            int complement=required-num;
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
    vector<int> values(n);
    for(int i=0;i<n;i++) cin>>values[i];
    int required;
    cin>>required;
    solution sol;
    vector<int> result=sol.locatePairPositions(values,required);
    if(!result.empty()){
        cout<<result[0]<<" "<<result[1]<<"\n";
    }else{
        cout<<-1<<"\n";
    }
    return 0;
}